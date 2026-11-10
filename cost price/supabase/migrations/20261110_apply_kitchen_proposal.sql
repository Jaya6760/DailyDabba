-- Migration: Stale Proposal Optimistic Concurrency Control (OCC) Stored Procedure
-- Function: apply_kitchen_proposal
-- Executes targeted ingredient, conversion, gas, and recipe mutations atomically
-- within a single PostgreSQL transaction with row-level locks and optimistic concurrency checks.

CREATE OR REPLACE FUNCTION apply_kitchen_proposal(p_proposal JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_operations JSONB := p_proposal->'operations';
  v_upd_ing JSONB;
  v_upd_conv JSONB;
  v_gas_upd JSONB;
  v_new_ing JSONB;
  v_rec_create JSONB;
  v_rec_upd JSONB;
  
  v_current_cost NUMERIC;
  v_current_qty NUMERIC;
  v_current_unit TEXT;
  
  v_current_weight NUMERIC;
  
  v_current_price NUMERIC;
  v_current_cyl_weight NUMERIC;
  v_current_consumption NUMERIC;

  -- Temporary-to-Real ID remapping table
  v_temp_id_map JSONB := '{}'::jsonb;
  v_real_ing_id TEXT;
  v_real_conv_id TEXT;
  v_resolved_ingredients JSONB;
  v_ing_elem JSONB;
  v_ref_id TEXT;
BEGIN
  -- =========================================================================
  -- STEP 1: VALIDATION & OPTIMISTIC CONCURRENCY CONTROL (OCC)
  -- =========================================================================

  -- 1a. Validate and lock updated ingredients
  IF v_operations ? 'updatedIngredients' AND jsonb_array_length(v_operations->'updatedIngredients') > 0 THEN
    FOR v_upd_ing IN SELECT * FROM jsonb_array_elements(v_operations->'updatedIngredients')
    LOOP
      SELECT "purchaseCost", "purchaseQty", "purchaseUnit"
      INTO v_current_cost, v_current_qty, v_current_unit
      FROM ingredients
      WHERE id = (v_upd_ing->>'id')
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'CONFLICT: Ingredient "%" (ID: %) was deleted from the database', 
          (v_upd_ing->>'name'), (v_upd_ing->>'id');
      END IF;

      IF v_current_cost IS DISTINCT FROM (v_upd_ing->'previous'->>'purchaseCost')::numeric OR
         v_current_qty IS DISTINCT FROM (v_upd_ing->'previous'->>'purchaseQty')::numeric OR
         v_current_unit IS DISTINCT FROM (v_upd_ing->'previous'->>'purchaseUnit') THEN
        RAISE EXCEPTION 'CONFLICT: Ingredient "%" was modified concurrently (current price: ₹% for % %, was: ₹% for % % when proposal was prepared)',
          (v_upd_ing->>'name'), 
          v_current_cost, v_current_qty, v_current_unit,
          (v_upd_ing->'previous'->>'purchaseCost'), (v_upd_ing->'previous'->>'purchaseQty'), (v_upd_ing->'previous'->>'purchaseUnit');
      END IF;
    END LOOP;
  END IF;

  -- 1b. Validate and lock updated conversions
  IF v_operations ? 'updatedConversions' AND jsonb_array_length(v_operations->'updatedConversions') > 0 THEN
    FOR v_upd_conv IN SELECT * FROM jsonb_array_elements(v_operations->'updatedConversions')
    LOOP
      SELECT "weightGrams"
      INTO v_current_weight
      FROM conversions
      WHERE id = (v_upd_conv->>'id')
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'CONFLICT: Conversion "%" was deleted from the database', (v_upd_conv->>'name');
      END IF;

      IF v_current_weight IS DISTINCT FROM (v_upd_conv->>'previousWeightGrams')::numeric THEN
        RAISE EXCEPTION 'CONFLICT: Teaspoon conversion "%" was modified concurrently (current: 1 tsp = %g, was: %g when proposal was prepared)',
          (v_upd_conv->>'name'), v_current_weight, (v_upd_conv->>'previousWeightGrams');
      END IF;
    END LOOP;
  END IF;

  -- 1c. Validate gas config update
  IF v_operations ? 'gasConfigUpdate' AND (v_operations->>'gasConfigUpdate') IS NOT NULL THEN
    v_gas_upd := v_operations->'gasConfigUpdate';
    
    SELECT "cylinderPrice", "cylinderWeightKg", "consumptionRateKgHour"
    INTO v_current_price, v_current_cyl_weight, v_current_consumption
    FROM gas_config
    WHERE id = 'singleton'
    FOR UPDATE;

    IF FOUND THEN
      IF v_current_price IS DISTINCT FROM (v_gas_upd->'previous'->>'cylinderPrice')::numeric OR
         v_current_cyl_weight IS DISTINCT FROM (v_gas_upd->'previous'->>'cylinderWeightKg')::numeric OR
         v_current_consumption IS DISTINCT FROM (v_gas_upd->'previous'->>'consumptionRateKgHour')::numeric THEN
        RAISE EXCEPTION 'CONFLICT: Gas configuration was modified concurrently (current price: ₹%, was: ₹% when proposal was prepared)',
          v_current_price, (v_gas_upd->'previous'->>'cylinderPrice');
      END IF;
    END IF;
  END IF;

  -- 1d. Validate duplicate names for new ingredients
  IF v_operations ? 'newIngredients' AND jsonb_array_length(v_operations->'newIngredients') > 0 THEN
    FOR v_new_ing IN SELECT * FROM jsonb_array_elements(v_operations->'newIngredients')
    LOOP
      IF EXISTS (
        SELECT 1 FROM ingredients 
        WHERE LOWER(TRIM(name)) = LOWER(TRIM(v_new_ing->>'name'))
      ) THEN
        RAISE EXCEPTION 'CONFLICT: An ingredient named "%" already exists in the database', (v_new_ing->>'name');
      END IF;
    END LOOP;
  END IF;

  -- 1e. Validate duplicate names for new recipes
  IF v_operations ? 'recipesToCreate' AND jsonb_array_length(v_operations->'recipesToCreate') > 0 THEN
    FOR v_rec_create IN SELECT * FROM jsonb_array_elements(v_operations->'recipesToCreate')
    LOOP
      IF EXISTS (
        SELECT 1 FROM recipes 
        WHERE LOWER(TRIM(name)) = LOWER(TRIM(v_rec_create->'recipe'->>'name'))
      ) THEN
        RAISE EXCEPTION 'CONFLICT: A recipe named "%" already exists in the database', (v_rec_create->'recipe'->>'name');
      END IF;
    END LOOP;
  END IF;

  -- =========================================================================
  -- STEP 2: EXECUTE ATOMIC WRITES
  -- =========================================================================

  -- 2a. Insert new ingredients (with robust real ID generation from tempId)
  IF v_operations ? 'newIngredients' AND jsonb_array_length(v_operations->'newIngredients') > 0 THEN
    FOR v_new_ing IN SELECT * FROM jsonb_array_elements(v_operations->'newIngredients')
    LOOP
      v_real_ing_id := COALESCE(
        NULLIF(v_new_ing->>'id', ''),
        'ing_' || floor(extract(epoch from clock_timestamp()) * 1000)::text || '_' || substr(md5(random()::text), 1, 4)
      );

      -- Record tempId -> realId mapping for recipe ingredients remapping
      IF (v_new_ing->>'tempId') IS NOT NULL THEN
        v_temp_id_map := v_temp_id_map || jsonb_build_object(v_new_ing->>'tempId', v_real_ing_id);
      END IF;

      INSERT INTO ingredients (id, name, "purchaseQty", "purchaseUnit", "purchaseCost", "costPerUnit")
      VALUES (
        v_real_ing_id,
        v_new_ing->>'name',
        (v_new_ing->>'purchaseQty')::numeric,
        v_new_ing->>'purchaseUnit',
        (v_new_ing->>'purchaseCost')::numeric,
        (v_new_ing->>'costPerUnit')::numeric
      );
    END LOOP;
  END IF;

  -- 2b. Update ingredients
  IF v_operations ? 'updatedIngredients' AND jsonb_array_length(v_operations->'updatedIngredients') > 0 THEN
    FOR v_upd_ing IN SELECT * FROM jsonb_array_elements(v_operations->'updatedIngredients')
    LOOP
      UPDATE ingredients
      SET 
        "purchaseQty" = (v_upd_ing->'proposed'->>'purchaseQty')::numeric,
        "purchaseUnit" = v_upd_ing->'proposed'->>'purchaseUnit',
        "purchaseCost" = (v_upd_ing->'proposed'->>'purchaseCost')::numeric,
        "costPerUnit" = (v_upd_ing->'proposed'->>'costPerUnit')::numeric
      WHERE id = (v_upd_ing->>'id');
    END LOOP;
  END IF;

  -- 2c. Insert new conversions (with robust ID generation)
  IF v_operations ? 'newConversions' AND jsonb_array_length(v_operations->'newConversions') > 0 THEN
    FOR v_upd_conv IN SELECT * FROM jsonb_array_elements(v_operations->'newConversions')
    LOOP
      v_real_conv_id := COALESCE(
        NULLIF(v_upd_conv->>'id', ''),
        'conv_' || floor(extract(epoch from clock_timestamp()) * 1000)::text || '_' || substr(md5(random()::text), 1, 4)
      );

      INSERT INTO conversions (id, name, "weightGrams")
      VALUES (
        v_real_conv_id,
        v_upd_conv->>'name',
        (v_upd_conv->>'weightGrams')::numeric
      );
    END LOOP;
  END IF;

  -- 2d. Update existing conversions
  IF v_operations ? 'updatedConversions' AND jsonb_array_length(v_operations->'updatedConversions') > 0 THEN
    FOR v_upd_conv IN SELECT * FROM jsonb_array_elements(v_operations->'updatedConversions')
    LOOP
      UPDATE conversions
      SET "weightGrams" = (v_upd_conv->>'proposedWeightGrams')::numeric
      WHERE id = (v_upd_conv->>'id');
    END LOOP;
  END IF;

  -- 2e. Update gas config
  IF v_operations ? 'gasConfigUpdate' AND (v_operations->>'gasConfigUpdate') IS NOT NULL THEN
    v_gas_upd := v_operations->'gasConfigUpdate'->'proposed';
    INSERT INTO gas_config (id, "cylinderPrice", "cylinderWeightKg", "consumptionRateKgHour")
    VALUES (
      'singleton',
      (v_gas_upd->>'cylinderPrice')::numeric,
      (v_gas_upd->>'cylinderWeightKg')::numeric,
      (v_gas_upd->>'consumptionRateKgHour')::numeric
    )
    ON CONFLICT (id) DO UPDATE SET
      "cylinderPrice" = EXCLUDED."cylinderPrice",
      "cylinderWeightKg" = EXCLUDED."cylinderWeightKg",
      "consumptionRateKgHour" = EXCLUDED."consumptionRateKgHour";
  END IF;

  -- 2f. Insert new recipes (remapping any temporary ingredient IDs to real IDs)
  IF v_operations ? 'recipesToCreate' AND jsonb_array_length(v_operations->'recipesToCreate') > 0 THEN
    FOR v_rec_create IN SELECT * FROM jsonb_array_elements(v_operations->'recipesToCreate')
    LOOP
      v_resolved_ingredients := '[]'::jsonb;

      -- Iterate recipe ingredients and remap temp IDs if present
      FOR v_ing_elem IN SELECT * FROM jsonb_array_elements(v_rec_create->'recipe'->'ingredients')
      LOOP
        v_ref_id := v_ing_elem->>'ingredientId';
        IF v_temp_id_map ? v_ref_id THEN
          v_resolved_ingredients := v_resolved_ingredients || jsonb_build_array(
            jsonb_set(v_ing_elem, '{ingredientId}', to_jsonb(v_temp_id_map->>v_ref_id))
          );
        ELSE
          v_resolved_ingredients := v_resolved_ingredients || jsonb_build_array(v_ing_elem);
        END IF;
      END LOOP;

      INSERT INTO recipes (id, name, ingredients, "yieldType", "yieldAmount", "cookingTimeMins", "createdAt")
      VALUES (
        v_rec_create->'recipe'->>'id',
        v_rec_create->'recipe'->>'name',
        v_resolved_ingredients,
        v_rec_create->'recipe'->>'yieldType',
        (v_rec_create->'recipe'->>'yieldAmount')::numeric,
        (v_rec_create->'recipe'->>'cookingTimeMins')::numeric,
        COALESCE(v_rec_create->'recipe'->>'createdAt', NOW()::text)
      );
    END LOOP;
  END IF;

  -- 2g. Update existing recipes (if any)
  IF v_operations ? 'recipesToUpdate' AND jsonb_array_length(v_operations->'recipesToUpdate') > 0 THEN
    FOR v_rec_upd IN SELECT * FROM jsonb_array_elements(v_operations->'recipesToUpdate')
    LOOP
      UPDATE recipes
      SET
        name = v_rec_upd->'proposed'->>'name',
        ingredients = v_rec_upd->'proposed'->'ingredients',
        "yieldType" = v_rec_upd->'proposed'->>'yieldType',
        "yieldAmount" = (v_rec_upd->'proposed'->>'yieldAmount')::numeric,
        "cookingTimeMins" = (v_rec_upd->'proposed'->>'cookingTimeMins')::numeric
      WHERE id = (v_rec_upd->>'id');
    END LOOP;
  END IF;

  -- Return success payload
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Proposal successfully committed atomically'
  );
END;
$$;

-- Revoke default public execution and grant specifically to application roles
REVOKE EXECUTE ON FUNCTION apply_kitchen_proposal(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_kitchen_proposal(JSONB) TO anon, authenticated, service_role;
