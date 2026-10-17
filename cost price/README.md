# Food Costing Calculator (Daily Dabba)

A food costing and recipe pricing application designed for commercial kitchens and cloud kitchens to calculate the precise Cost Price (CP) of cooked dishes per batch and per serving. Includes an integrated **AI Kitchen Assistant powered by Gemini 3.8 Flash** for conversational food costing and inventory management.

---

## 1. What This Application Does
- Calculates exact batch costs and per-serving cost price for recipes.
- Dynamically accounts for raw material costs, volume/spoon conversions, and cooking gas consumption.
- Supports both weight-based (grams) and piece-based (count) dish yields.
- Exports calculated dish serving cost prices to CSV.
- **Natural Language AI Assistant**: Single conversational input accepting freeform phrasing to audit costs, create/edit recipes, add/update ingredients, map teaspoon weights, adjust fuel parameters, and simulate "what-if" market price changes.

---

## 2. How It Achieves It
- **Ingredient Rate Normalization**: Manages raw ingredient purchase prices across multiple package units (`kg`, `g`, `litre`, `ml`) and normalizes them to base unit costs (₹/g or ₹/ml).
- **Unit & Spoon Conversions**: Translates kitchen measurements (e.g., teaspoons) into exact gram weights using configurable ingredient-specific conversion tables, with automated fallbacks (4g standard default).
- **Cooking Gas (LPG) Cost Allocation**: Computes cooking fuel cost per minute from cylinder price (₹), cylinder capacity (kg), and burner consumption rate (kg/hour), then factors in recipe cooking duration.
- **Portion & Yield Math**: Computes total batch cost (`Ingredient Costs + Gas Cost`), cost per 100g or per piece, and derives individual serving cost price based on custom or default portion sizes.
- **On-the-Fly Ingredient Creation**: Allows new ingredients to be registered directly while drafting a recipe or chatting with the AI.
- **Data Persistence**: Automatically syncs master ingredients, conversions, gas parameters, recipes, and dish costs to Supabase tables, with an offline fallback mode if database credentials are not configured.

---

## 3. AI Kitchen Assistant Architecture (Gemini 3.8 Flash)

The AI assistant connects through a secure backend endpoint (`/api/ai/chat`) integrated into Vite's dev/preview middleware and an optional standalone Node server.

### Key Principles
1. **Zero Hallucinated Math**: All costing calculations strictly reuse the backend mathematical formulas in `utils.ts` and `costingEngine.ts`. The LLM invokes tools (`calculate_recipe_cost`, `propose_save_recipe`) and never computes costs by mental arithmetic.
2. **Zero Invented Prices**: The AI cannot invent ingredient prices or missing data. If an ingredient is not in the master inventory, the tool prompts the user for purchase price and pack size before permitting a save.
3. **Safe Confirmation Workflow**: Database mutations (`ADD_INGREDIENT`, `UPDATE_INGREDIENT`, `SAVE_CONVERSION`, `UPDATE_GAS_CONFIG`, `SAVE_RECIPE`) are returned as proposed actions with interactive diff cards. Mutations are only persisted after explicit user confirmation in the UI.
4. **Interactive Clarification & Defaults**: When data is missing, the backend flags whether a system default exists (e.g. 4g per tsp fallback, 100g serving size, 10-minute cooking time) and provides 1-click buttons in the UI to either accept the default or input a custom value.
5. **Secure Key Management**: `GEMINI_API_KEY` is read strictly on the server/backend and is never exposed to client-side bundles or `import.meta.env`.

### Supported Conversational Operations
- **Calculate Recipe Costs**: *"How much does Jeera Poha cost to make?"* or *"What is the cost per serving of Standard Moong Dal?"*
- **What-If Price Simulations**: *"What if Moong Dal price rises to ₹200/kg?"*
- **Add Master Ingredients**: *"Add 1kg Amul Butter at 550 rupees"*
- **Update Ingredient Prices**: *"Update price of Refined Oil to 180"* (automatically computes cost deltas for all affected recipes)
- **Teaspoon / Weight Conversions**: *"Set teaspoon weight of Haldi to 3g"*
- **Cooking Gas Rates**: *"Update gas cylinder price to 980"*
- **Create / Edit Recipes**: *"Create recipe for Masala Chai: 200ml milk, 100ml water, 2 tsp sugar, 1 tsp chai patti, boil for 5 mins, yields 2 cups"*
- **Inventory & Recipe Search**: *"Which recipes use Groundnut?"* or *"Search inventory for spices"*

---

## 4. Tech Stack
- **UI & Logic**: React 19, TypeScript
- **Bundler & Dev Server**: Vite 6 with custom backend AI middleware
- **AI Engine**: Google GenAI SDK (`@google/genai` v2.28.0) using `gemini-3.8-flash` with function/tool calling
- **Styling & UI Components**: Tailwind CSS v4, Lucide React (icons), Motion
- **Database / Backend**: Supabase (`@supabase/supabase-js`) with offline fallback client
- **Testing**: Node.js native test runner (`node:test`) via `tsx`
- **Data Export**: Client-side CSV generation (UTF-8 with BOM)

---

## 5. Key Data Models
- **`Ingredient`**: Base purchase unit, purchase cost, and calculated cost-per-base-unit.
- **`TeaspoonConversion`**: Name-to-gram weight mappings for teaspoon measurements.
- **`GasConfig`**: Cylinder price, net weight (kg), and burner burn rate (kg/h).
- **`Recipe`**: Ingredients list, yield type (`weight` | `piece`), yield quantity, default portion size, and cooking time (minutes).
- **`DishServingCost`**: Computed serving cost price and batch cost summary for reporting and export.
- **`ProposedAction`**: Validated mutation proposal requiring user confirmation.
- **`ClarificationQuestion`**: Prompt for missing or ambiguous inputs with system defaults.

---

## 6. Getting Started

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
Create or update your `.env` (or `.env.local`):
```env
# Gemini API Key (Server-side only — never exposed to client)
GEMINI_API_KEY="your_gemini_api_key"

# Supabase (Optional — app falls back to in-memory defaults if omitted)
VITE_SUPABASE_URL="https://your-project.supabase.co"
VITE_SUPABASE_ANON_KEY="your_anon_key"
```

### 3. Run Automated Tests
Execute the test suite covering costing math, tool calling, edge cases, and deduplication:
```bash
npm test
```

### 4. Start Local Development Server
Starts the frontend and AI backend endpoints (`/api/ai/*`) on port 3000:
```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) to access the calculator and AI Kitchen Assistant.

### 5. Optional: Run Standalone AI Backend Server
```bash
npm run server
```
Runs the backend HTTP server independently on port 3001.
