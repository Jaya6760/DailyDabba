/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Centralized Canonical Ingredient Matching Engine.
 *
 * Implements a 5-tier matching pipeline with strict culinary form disambiguation:
 * 1. Exact name match
 * 2. Normalized name match (case, spaces, punctuation, benign prep words)
 * 3. Known Hindi-English & regional synonym match (form-aware)
 * 4. Known spelling variation match (form-aware)
 * 5. Fuzzy matching for possible spelling mistakes (requires user confirmation)
 *
 * Also detects inherently ambiguous ingredient inputs (e.g. bare "Dhaniya",
 * bare "Dal", bare "Methi") when multiple culinary forms/varieties exist.
 */

import { Ingredient, TeaspoonConversion } from '../types';

export type IngredientForm =
  | 'seeds'
  | 'whole'
  | 'powder'
  | 'roasted_powder'
  | 'leaves_fresh'
  | 'leaves_dried'
  | 'flakes'
  | 'sauce'
  | 'oil'
  | 'pulse'
  | 'flour'
  | 'grain'
  | 'dairy'
  | 'vegetable'
  | 'spice_blend'
  | 'general';

export type IngredientMatchOutcome =
  | 'EXACT_MATCH'
  | 'NORMALIZED_MATCH'
  | 'SYNONYM_MATCH'
  | 'SPELLING_VARIATION_MATCH'
  | 'AMBIGUOUS_MATCH'
  | 'NO_MATCH';

export interface CanonicalIngredientConcept {
  conceptId: string;
  canonicalName: string;
  legacyAliasKey: string;
  family: string;
  form: IngredientForm;
  exactNames: string[];
  synonyms: string[];
  spellingVariations: string[];
}

export interface IngredientMatchResult {
  inputName: string;
  normalizedInput: string;
  outcome: IngredientMatchOutcome;
  matchedIngredient: Ingredient | null;
  candidates: Ingredient[];
  canonicalConceptId?: string;
  canonicalName?: string;
  confidence: number;
  requiresConfirmation: boolean;
  ambiguityReason?: string;
}

/**
 * Centralized registry of canonical culinary concepts, separating distinct forms
 * (e.g. Coriander Seeds vs Coriander Powder vs Coriander Leaves; Whole Cumin vs
 * Cumin Powder vs Roasted Cumin Powder; Whole Black Pepper vs Black Pepper Powder;
 * Methi Seeds vs Kasuri Methi; Wheat Flour vs Maida; Moong Dal vs Toor Dal vs Chana Dal).
 */
export const CANONICAL_INGREDIENT_CONCEPTS: CanonicalIngredientConcept[] = [
  // --- Turmeric / Haldi ---
  {
    conceptId: 'turmeric',
    canonicalName: 'Turmeric',
    legacyAliasKey: 'haldi',
    family: 'turmeric',
    form: 'powder',
    exactNames: ['turmeric', 'haldi'],
    synonyms: ['turmeric powder', 'haldi powder', 'ground turmeric', 'manjal', 'haldi mirch'],
    spellingVariations: ['haldee', 'haldee powder', 'turmeric pdr', 'haldi pdr'],
  },

  // --- Cumin / Jeera Family (Form-Separated) ---
  {
    conceptId: 'cumin_whole',
    canonicalName: 'Cumin',
    legacyAliasKey: 'jeera',
    family: 'cumin',
    form: 'seeds',
    exactNames: ['cumin', 'jeera'],
    synonyms: ['cumin seeds', 'jeera seeds', 'sabut jeera', 'whole cumin', 'white cumin', 'akha jeera'],
    spellingVariations: ['zeera', 'zeera seeds', 'sabut zeera', 'jeeraa', 'cummin', 'cummin seeds'],
  },
  {
    conceptId: 'cumin_powder',
    canonicalName: 'Cumin Powder',
    legacyAliasKey: 'jeera powder',
    family: 'cumin',
    form: 'powder',
    exactNames: ['cumin powder', 'jeera powder'],
    synonyms: ['ground cumin', 'raw cumin powder', 'kacha jeera powder', 'pisa jeera'],
    spellingVariations: ['zeera powder', 'jeera pdr', 'cumin pdr', 'cummin powder'],
  },
  {
    conceptId: 'roasted_cumin_powder',
    canonicalName: 'Roasted Cumin Powder',
    legacyAliasKey: 'bhuna jeera powder',
    family: 'cumin',
    form: 'roasted_powder',
    exactNames: ['roasted cumin powder', 'bhuna jeera powder'],
    synonyms: ['bhuna jeera', 'roasted jeera powder', 'roasted ground cumin', 'sekha jeera powder'],
    spellingVariations: ['bhuna zeera powder', 'bhuna zeera', 'bhoona jeera powder', 'bhunna jeera powder'],
  },
  {
    conceptId: 'cumin_black_pepper_powder',
    canonicalName: 'Jeera Kali Mirch Powder',
    legacyAliasKey: 'jeera kali mirch powder',
    family: 'spice_blend',
    form: 'powder',
    exactNames: ['jeera kali mirch powder'],
    synonyms: ['cumin black pepper powder', 'jeera mari powder'],
    spellingVariations: ['zeera kali mirch powder', 'jeera kaali mirch powder'],
  },

  // --- Coriander / Dhaniya Family (Form-Separated) ---
  {
    conceptId: 'coriander_seeds',
    canonicalName: 'Coriander Seeds',
    legacyAliasKey: 'khand dhaniya',
    family: 'coriander',
    form: 'seeds',
    exactNames: ['coriander seeds', 'khand dhaniya', 'sabut dhaniya'],
    synonyms: ['dhaniya seeds', 'whole coriander', 'whole coriander seeds', 'akha dhaniya', 'sukha dhaniya seeds'],
    spellingVariations: ['sabut dhania', 'khand dhania', 'dhania seeds', 'corriander seeds'],
  },
  {
    conceptId: 'coriander_powder',
    canonicalName: 'Coriander Powder',
    legacyAliasKey: 'dhaniya powder',
    family: 'coriander',
    form: 'powder',
    exactNames: ['coriander powder', 'dhaniya powder', 'barik dhaniya powder'],
    synonyms: ['ground coriander', 'pisa dhaniya', 'dhaniya pdr'],
    spellingVariations: ['dhania powder', 'barik dhania powder', 'corriander powder'],
  },
  {
    conceptId: 'coriander_leaves',
    canonicalName: 'Coriander Leaves',
    legacyAliasKey: 'coriander',
    family: 'coriander',
    form: 'leaves_fresh',
    exactNames: ['coriander leaves', 'dhaniya patti', 'hara dhaniya'],
    synonyms: ['fresh coriander', 'fresh coriander leaves', 'cilantro', 'dhaniya leaves', 'kothimbir', 'green coriander'],
    spellingVariations: ['dhania patti', 'hara dhania', 'dhania leaves', 'corriander leaves', 'dhaniya patta'],
  },

  // --- Black Pepper / Kali Mirch Family (Form-Separated) ---
  {
    conceptId: 'black_pepper_whole',
    canonicalName: 'Black Pepper',
    legacyAliasKey: 'kali mirch',
    family: 'black_pepper',
    form: 'whole',
    exactNames: ['black pepper', 'kali mirch'],
    synonyms: ['whole black pepper', 'black peppercorns', 'peppercorns', 'sabut kali mirch', 'kali miri'],
    spellingVariations: ['kaali mirch', 'kalimirch', 'sabut kaali mirch'],
  },
  {
    conceptId: 'black_pepper_powder',
    canonicalName: 'Black Pepper Powder',
    legacyAliasKey: 'kali mirch powder',
    family: 'black_pepper',
    form: 'powder',
    exactNames: ['black pepper powder', 'kali mirch powder'],
    synonyms: ['ground black pepper', 'crushed black pepper', 'black pepper pdr', 'kali miri powder'],
    spellingVariations: ['kaali mirch powder', 'kalimirch powder', 'kali mirch pdr'],
  },

  // --- Fenugreek / Methi Family (Form-Separated) ---
  {
    conceptId: 'fenugreek_seeds',
    canonicalName: 'Methi Seeds',
    legacyAliasKey: 'methi dana',
    family: 'fenugreek',
    form: 'seeds',
    exactNames: ['methi dana', 'methi seeds', 'fenugreek seeds'],
    synonyms: ['whole fenugreek', 'sabut methi', 'methi daana'],
    spellingVariations: ['methidana', 'menthya', 'fenugrek seeds'],
  },
  {
    conceptId: 'kasuri_methi',
    canonicalName: 'Kasuri Methi',
    legacyAliasKey: 'kastoori methi',
    family: 'fenugreek',
    form: 'leaves_dried',
    exactNames: ['kasuri methi', 'kastoori methi'],
    synonyms: ['dried fenugreek leaves', 'dry fenugreek leaves', 'dried methi', 'dry methi leaves', 'fenugreek leaves'],
    spellingVariations: ['kastori methi', 'kasoori methi', 'kasturi methi', 'kasuri methee'],
  },
  {
    conceptId: 'fresh_methi',
    canonicalName: 'Fresh Methi Leaves',
    legacyAliasKey: 'fresh methi',
    family: 'fenugreek',
    form: 'leaves_fresh',
    exactNames: ['fresh methi', 'hara methi', 'methi leaves'],
    synonyms: ['fresh fenugreek', 'fresh fenugreek leaves', 'methi bhaji', 'methi patti'],
    spellingVariations: ['hari methi', 'fresh methee'],
  },

  // --- Onion & Tomato & Everyday Vegetables ---
  {
    conceptId: 'onion',
    canonicalName: 'Onion',
    legacyAliasKey: 'onion',
    family: 'onion',
    form: 'vegetable',
    exactNames: ['onion', 'pyaaz'],
    synonyms: ['onions', 'kanda', 'red onion', 'red onions', 'chopped onion', 'sliced onion'],
    spellingVariations: ['pyaz', 'piyaz', 'pyaj', 'piaz', 'pyaaj', 'onoin'],
  },
  {
    conceptId: 'tomato',
    canonicalName: 'Tomato',
    legacyAliasKey: 'tomato',
    family: 'tomato',
    form: 'vegetable',
    exactNames: ['tomato', 'tamatar'],
    synonyms: ['tomatoes', 'fresh tomato', 'red tomato', 'chopped tomato'],
    spellingVariations: ['tamaatar', 'tamater', 'tmatar', 'tomatos'],
  },
  {
    conceptId: 'potato',
    canonicalName: 'Potato',
    legacyAliasKey: 'potato',
    family: 'potato',
    form: 'vegetable',
    exactNames: ['potato', 'aloo'],
    synonyms: ['potatoes', 'raw potato'],
    spellingVariations: ['alu', 'aaloo', 'aalu'],
  },
  {
    conceptId: 'ginger',
    canonicalName: 'Ginger',
    legacyAliasKey: 'ginger',
    family: 'ginger',
    form: 'vegetable',
    exactNames: ['ginger', 'adrak'],
    synonyms: ['fresh ginger', 'ginger root', 'chopped ginger', 'grated ginger'],
    spellingVariations: ['adrakh', 'aadarak', 'adarak'],
  },
  {
    conceptId: 'garlic',
    canonicalName: 'Garlic',
    legacyAliasKey: 'garlic',
    family: 'garlic',
    form: 'vegetable',
    exactNames: ['garlic', 'lahsun', 'lehsun'],
    synonyms: ['garlic cloves', 'fresh garlic', 'chopped garlic', 'minced garlic'],
    spellingVariations: ['lasun', 'lassan', 'lahsan', 'lehsan'],
  },
  {
    conceptId: 'green_chilli',
    canonicalName: 'Green Chilli',
    legacyAliasKey: 'green chilli',
    family: 'chilli',
    form: 'vegetable',
    exactNames: ['green chilli', 'hari mirch'],
    synonyms: ['green chillies', 'green chili', 'green chilies', 'fresh green chilli', 'chopped green chilli'],
    spellingVariations: ['hari mirchi', 'hara mirch', 'green chilly', 'green mirch'],
  },

  // --- Flours & Grains (Form/Type-Separated) ---
  {
    conceptId: 'wheat_flour',
    canonicalName: 'Wheat Flour',
    legacyAliasKey: 'wheat flour',
    family: 'flour',
    form: 'flour',
    exactNames: ['wheat flour', 'atta'],
    synonyms: ['whole wheat flour', 'gehu atta', 'gehun ka atta', 'chapati flour', 'roti atta', 'chakki atta'],
    spellingVariations: ['aata', 'gehu aata', 'gehun atta', 'wheatflour'],
  },
  {
    conceptId: 'maida',
    canonicalName: 'Maida',
    legacyAliasKey: 'maida',
    family: 'flour',
    form: 'flour',
    exactNames: ['maida'],
    synonyms: ['all purpose flour', 'all-purpose flour', 'refined wheat flour', 'refined flour', 'plain flour'],
    spellingVariations: ['mayda', 'meda'],
  },
  {
    conceptId: 'besan',
    canonicalName: 'Besan',
    legacyAliasKey: 'besan',
    family: 'flour',
    form: 'flour',
    exactNames: ['besan', 'gram flour'],
    synonyms: ['chickpea flour', 'chana flour', 'besan flour'],
    spellingVariations: ['bessan', 'besan atta'],
  },
  {
    conceptId: 'suji',
    canonicalName: 'Suji',
    legacyAliasKey: 'suji',
    family: 'flour',
    form: 'grain',
    exactNames: ['suji', 'semolina', 'rava'],
    synonyms: ['roasted suji', 'fine semolina'],
    spellingVariations: ['sooji', 'rawa', 'sujee'],
  },
  {
    conceptId: 'rice',
    canonicalName: 'Rice',
    legacyAliasKey: 'rice',
    family: 'grain',
    form: 'grain',
    exactNames: ['rice', 'chawal'],
    synonyms: ['raw rice', 'white rice', 'steamed rice grain'],
    spellingVariations: ['chaawal', 'chaval'],
  },
  {
    conceptId: 'poha',
    canonicalName: 'Poha',
    legacyAliasKey: 'poha',
    family: 'grain',
    form: 'grain',
    exactNames: ['poha'],
    synonyms: ['flattened rice', 'beaten rice', 'chivda', 'aval', 'thick poha'],
    spellingVariations: ['pohe', 'pauaa', 'paua', 'pohaa'],
  },

  // --- Dals & Pulses (Strictly Separated by Variety) ---
  {
    conceptId: 'moong_dal',
    canonicalName: 'Moong Dal',
    legacyAliasKey: 'moong dal',
    family: 'dal',
    form: 'pulse',
    exactNames: ['moong dal'],
    synonyms: ['yellow moong dal', 'dhuli moong', 'dhuli moong dal', 'split yellow moong', 'mung dal', 'yellow moong'],
    spellingVariations: ['moong daal', 'mung daal', 'mug dal'],
  },
  {
    conceptId: 'toor_dal',
    canonicalName: 'Toor Dal',
    legacyAliasKey: 'tur dal',
    family: 'dal',
    form: 'pulse',
    exactNames: ['toor dal', 'tur dal', 'arhar dal'],
    synonyms: ['tuvar dal', 'split pigeon peas', 'yellow pigeon peas', 'arhar ki dal'],
    spellingVariations: ['toor daal', 'tur daal', 'arhar daal', 'tuvar daal', 'tuwar dal'],
  },
  {
    conceptId: 'chana_dal',
    canonicalName: 'Chana Dal',
    legacyAliasKey: 'chana dal',
    family: 'dal',
    form: 'pulse',
    exactNames: ['chana dal'],
    synonyms: ['split bengal gram', 'bengal gram dal', 'chana ki dal'],
    spellingVariations: ['chana daal', 'channa dal', 'channa daal'],
  },
  {
    conceptId: 'urad_dal',
    canonicalName: 'Urad Dal',
    legacyAliasKey: 'urad dal',
    family: 'dal',
    form: 'pulse',
    exactNames: ['urad dal'],
    synonyms: ['dhuli urad dal', 'white urad dal', 'split black gram', 'mash dal'],
    spellingVariations: ['urad daal', 'udad dal', 'udad daal'],
  },
  {
    conceptId: 'masoor_dal',
    canonicalName: 'Masoor Dal',
    legacyAliasKey: 'masoor dal',
    family: 'dal',
    form: 'pulse',
    exactNames: ['masoor dal'],
    synonyms: ['red lentils', 'pink lentils', 'malka masoor'],
    spellingVariations: ['masoor daal', 'masur dal', 'masur daal'],
  },
  {
    conceptId: 'mix_dal',
    canonicalName: 'Mix Dal',
    legacyAliasKey: 'mix dal',
    family: 'dal',
    form: 'pulse',
    exactNames: ['mix dal', 'mixed dal'],
    synonyms: ['panchmel dal', 'panchratna dal', 'mixed lentils'],
    spellingVariations: ['mix daal', 'mixed daal'],
  },
  {
    conceptId: 'chole',
    canonicalName: 'Chole',
    legacyAliasKey: 'chole',
    family: 'pulse',
    form: 'pulse',
    exactNames: ['chole', 'chickpeas', 'kabuli chana'],
    synonyms: ['white chickpeas', 'garbanzo beans', 'safed chana'],
    spellingVariations: ['chhole', 'choley', 'chole chana', 'kabuli channa'],
  },
  {
    conceptId: 'kala_chana',
    canonicalName: 'Chana',
    legacyAliasKey: 'chana',
    family: 'pulse',
    form: 'pulse',
    exactNames: ['chana', 'kala chana'],
    synonyms: ['black chickpeas', 'desi chana', 'brown chickpeas'],
    spellingVariations: ['kaala chana', 'channa', 'kala channa'],
  },
  {
    conceptId: 'rajma',
    canonicalName: 'Rajma',
    legacyAliasKey: 'rajma',
    family: 'pulse',
    form: 'pulse',
    exactNames: ['rajma', 'kidney beans'],
    synonyms: ['red kidney beans', 'chitra rajma', 'jammu rajma'],
    spellingVariations: ['raajma', 'rajmah'],
  },

  // --- Dairy & Proteins ---
  {
    conceptId: 'paneer',
    canonicalName: 'Paneer',
    legacyAliasKey: 'paneer',
    family: 'dairy',
    form: 'dairy',
    exactNames: ['paneer'],
    synonyms: ['cottage cheese', 'indian cottage cheese', 'chopped paneer', 'paneer cubes', 'fresh paneer', 'malai paneer'],
    spellingVariations: ['panner', 'panir', 'ponir'],
  },
  {
    conceptId: 'ghee',
    canonicalName: 'Amul Ghee',
    legacyAliasKey: 'amul ghee',
    family: 'oil',
    form: 'oil',
    exactNames: ['amul ghee', 'ghee'],
    synonyms: ['desi ghee', 'pure ghee', 'clarified butter', 'cow ghee'],
    spellingVariations: ['ghi', 'deshi ghee'],
  },
  {
    conceptId: 'soya_chunks',
    canonicalName: 'Soya Chunks',
    legacyAliasKey: 'soya chunks',
    family: 'general',
    form: 'general',
    exactNames: ['soya chunks'],
    synonyms: ['soy chunks', 'nutrela', 'soya vadi', 'soya badi', 'meal maker'],
    spellingVariations: ['soyabean chunks', 'soya chunk'],
  },
  {
    conceptId: 'boondi',
    canonicalName: 'Bondi',
    legacyAliasKey: 'bondi',
    family: 'general',
    form: 'general',
    exactNames: ['bondi', 'boondi'],
    synonyms: ['raita boondi', 'salted boondi', 'kara boondi'],
    spellingVariations: ['bundi'],
  },

  // --- Salts & Sweeteners ---
  {
    conceptId: 'salt',
    canonicalName: 'Salt',
    legacyAliasKey: 'salt',
    family: 'salt',
    form: 'general',
    exactNames: ['salt', 'namak'],
    synonyms: ['white salt', 'iodized salt', 'table salt', 'common salt', 'safed namak'],
    spellingVariations: ['namac', 'namk'],
  },
  {
    conceptId: 'black_salt',
    canonicalName: 'Black Salt',
    legacyAliasKey: 'black salt',
    family: 'salt',
    form: 'general',
    exactNames: ['black salt', 'kala namak'],
    synonyms: ['sanchal', 'rock black salt', 'pink black salt'],
    spellingVariations: ['kaala namak', 'kalanamak'],
  },
  {
    conceptId: 'sugar',
    canonicalName: 'Sugar',
    legacyAliasKey: 'sugar',
    family: 'sweetener',
    form: 'general',
    exactNames: ['sugar', 'cheeni'],
    synonyms: ['shakkar', 'white sugar', 'refined sugar', 'granulated sugar', 'bura'],
    spellingVariations: ['chini', 'shakar', 'cheenee'],
  },

  // --- Oils ---
  {
    conceptId: 'refined_oil',
    canonicalName: 'Refined Oil',
    legacyAliasKey: 'refined oil',
    family: 'oil',
    form: 'oil',
    exactNames: ['refined oil'],
    synonyms: ['oil', 'cooking oil', 'vegetable oil', 'sunflower oil', 'soyabean oil', 'neutral oil'],
    spellingVariations: ['refine oil', 'refind oil'],
  },
  {
    conceptId: 'mustard_oil',
    canonicalName: 'Mustard Oil',
    legacyAliasKey: 'mustard oil',
    family: 'oil',
    form: 'oil',
    exactNames: ['mustard oil', 'sarson oil'],
    synonyms: ['sarson ka tel', 'kachi ghani mustard oil', 'kachi ghani oil'],
    spellingVariations: ['sarso oil', 'sarso ka tel', 'musterd oil'],
  },

  // --- Nuts & Seeds ---
  {
    conceptId: 'groundnut',
    canonicalName: 'Groundnut',
    legacyAliasKey: 'groundnut',
    family: 'nut',
    form: 'seeds',
    exactNames: ['groundnut', 'peanut', 'peanuts', 'mungfali'],
    synonyms: ['groundnuts', 'raw peanuts', 'singdana', 'shengdana', 'kachi mungfali'],
    spellingVariations: ['moongfali', 'moongphali', 'mungphali', 'peenut', 'peenuts'],
  },
  {
    conceptId: 'badam',
    canonicalName: 'Badam',
    legacyAliasKey: 'badam',
    family: 'nut',
    form: 'whole',
    exactNames: ['badam', 'almond', 'almonds'],
    synonyms: ['raw almonds', 'whole almonds'],
    spellingVariations: ['badaam'],
  },
  {
    conceptId: 'kaju',
    canonicalName: 'Kaju',
    legacyAliasKey: 'kaju',
    family: 'nut',
    form: 'whole',
    exactNames: ['kaju', 'cashew', 'cashews'],
    synonyms: ['cashew nuts', 'whole cashews', 'kaju tukda'],
    spellingVariations: ['kaaju', 'cashewnut'],
  },
  {
    conceptId: 'ajwain',
    canonicalName: 'Ajwain',
    legacyAliasKey: 'ajwain',
    family: 'spice_whole',
    form: 'seeds',
    exactNames: ['ajwain', 'carom seeds'],
    synonyms: ['bishop weed', 'ajwain seeds'],
    spellingVariations: ['ajwaen', 'ajvain', 'ajwayan', 'omam'],
  },
  {
    conceptId: 'kalonji',
    canonicalName: 'Kalonji',
    legacyAliasKey: 'kalonji',
    family: 'spice_whole',
    form: 'seeds',
    exactNames: ['kalonji', 'nigella seeds'],
    synonyms: ['black cumin', 'onion seeds', 'kalonji seeds'],
    spellingVariations: ['kalongi', 'kalaunji', 'mangrail'],
  },
  {
    conceptId: 'mustard_seeds',
    canonicalName: 'Rai',
    legacyAliasKey: 'rai',
    family: 'spice_whole',
    form: 'seeds',
    exactNames: ['rai', 'mustard seeds'],
    synonyms: ['black mustard seeds', 'sarson seeds', 'rai dana', 'kadugu'],
    spellingVariations: ['raai', 'rye seeds'],
  },

  // --- Chillies, Herbs, Sauces & Masalas ---
  {
    conceptId: 'red_chilli_flakes',
    canonicalName: 'Red Chilli Flakes',
    legacyAliasKey: 'red chilli flakes',
    family: 'chilli',
    form: 'flakes',
    exactNames: ['red chilli flakes', 'chilli flakes'],
    synonyms: ['chili flakes', 'red chili flakes', 'crushed red pepper', 'kutti mirch', 'kuti lal mirch'],
    spellingVariations: ['chilly flakes', 'red chilly flakes', 'chilli flake'],
  },
  {
    conceptId: 'kashmiri_chilli_powder',
    canonicalName: 'Kashmiri Laal Mirch Powder',
    legacyAliasKey: 'kashmiri laal mirch powder',
    family: 'chilli',
    form: 'powder',
    exactNames: ['kashmiri laal mirch powder', 'kashmiri red chilli powder'],
    synonyms: ['kashmiri lal mirch', 'kashmiri lal mirch powder', 'kashmiri mirch powder', 'degi mirch', 'kashmiri chilli powder'],
    spellingVariations: ['kashmiri chili powder', 'kashmiri chilly powder'],
  },
  {
    conceptId: 'spicy_chilli_powder',
    canonicalName: 'Teekhi Laal Mirch',
    legacyAliasKey: 'teekhi laal mirch',
    family: 'chilli',
    form: 'powder',
    exactNames: ['teekhi laal mirch', 'red chilli powder'],
    synonyms: ['teekhi lal mirch', 'lal mirch powder', 'laal mirch powder', 'red chili powder', 'chilli powder'],
    spellingVariations: ['tikhi lal mirch', 'teekhi mirch powder', 'red chilly powder'],
  },
  {
    conceptId: 'red_chilli_sauce',
    canonicalName: 'Red Chilli Sauce',
    legacyAliasKey: 'red chilli sauce',
    family: 'chilli',
    form: 'sauce',
    exactNames: ['red chilli sauce'],
    synonyms: ['red chili sauce', 'chilli sauce'],
    spellingVariations: ['red chilly sauce'],
  },
  {
    conceptId: 'green_chilli_sauce',
    canonicalName: 'Green Chilli Sauce',
    legacyAliasKey: 'green chilli sauce',
    family: 'chilli',
    form: 'sauce',
    exactNames: ['green chilli sauce'],
    synonyms: ['green chili sauce'],
    spellingVariations: ['green chilly sauce'],
  },
  {
    conceptId: 'oregano',
    canonicalName: 'Oregano',
    legacyAliasKey: 'oregano',
    family: 'herb',
    form: 'leaves_dried',
    exactNames: ['oregano'],
    synonyms: ['dried oregano', 'oregano seasoning', 'pizza oregano'],
    spellingVariations: ['origano', 'oregeno'],
  },
  {
    conceptId: 'chat_masala',
    canonicalName: 'Chat Masala',
    legacyAliasKey: 'chat masala',
    family: 'spice_blend',
    form: 'powder',
    exactNames: ['chat masala', 'chaat masala'],
    synonyms: ['chat masala powder', 'chaat masala powder'],
    spellingVariations: ['chatmasala', 'chaat masaala'],
  },
  {
    conceptId: 'garam_masala',
    canonicalName: 'Garam Masala',
    legacyAliasKey: 'garam masala',
    family: 'spice_blend',
    form: 'powder',
    exactNames: ['garam masala'],
    synonyms: ['garam masala powder', 'whole spice blend powder'],
    spellingVariations: ['garam masaala'],
  },
  {
    conceptId: 'chole_masala',
    canonicalName: 'Chole Masala',
    legacyAliasKey: 'chole masala',
    family: 'spice_blend',
    form: 'powder',
    exactNames: ['chole masala'],
    synonyms: ['chana masala', 'chana masala powder', 'chole masala powder'],
    spellingVariations: ['chhole masala', 'choley masala'],
  },
  {
    conceptId: 'kitchen_king_masala',
    canonicalName: 'Kitchen King Masala',
    legacyAliasKey: 'kitchen king masala',
    family: 'spice_blend',
    form: 'powder',
    exactNames: ['kitchen king masala', 'kitchen king'],
    synonyms: ['kitchen king powder'],
    spellingVariations: ['kitchenking masala'],
  },
  {
    conceptId: 'maggi_masala',
    canonicalName: 'Maggi Magic Masala',
    legacyAliasKey: 'maggi magic masala',
    family: 'spice_blend',
    form: 'powder',
    exactNames: ['maggi magic masala', 'maggi masala'],
    synonyms: ['magic masala', 'maggi masala-ae-magic', 'maggi seasoning'],
    spellingVariations: ['maggie masala', 'maggie magic masala', 'magi masala'],
  },
];

/**
 * Benign preparation or size adjectives that do not change the canonical ingredient identity.
 * NEVER includes form qualifiers (seeds, powder, leaves, roasted, dried, flakes, sauce)
 * or variety qualifiers (moong, toor, chana, wheat, maida, kali, kashmiri, kala, mustard).
 */
const BENIGN_PREP_MODIFIERS = new Set([
  'chopped',
  'finely',
  'fine',
  'diced',
  'sliced',
  'minced',
  'grated',
  'peeled',
  'washed',
  'cleaned',
  'medium',
  'large',
  'small',
  'big',
  'organic',
  'standard',
  'regular',
]);

/**
 * Bare root terms that are inherently ambiguous when multiple forms or varieties exist in the catalog.
 */
const AMBIGUOUS_ROOT_FAMILIES: Record<string, { family: string; description: string }> = {
  dhaniya: {
    family: 'coriander',
    description: 'Coriander Seeds, Coriander Powder, or Coriander Leaves',
  },
  dhania: {
    family: 'coriander',
    description: 'Coriander Seeds, Coriander Powder, or Coriander Leaves',
  },
  coriander: {
    family: 'coriander',
    description: 'Coriander Seeds, Coriander Powder, or Coriander Leaves',
  },
  methi: {
    family: 'fenugreek',
    description: 'Methi Seeds (Methi Dana), Kasuri Methi (dried leaves), or Fresh Methi Leaves',
  },
  fenugreek: {
    family: 'fenugreek',
    description: 'Fenugreek Seeds (Methi Dana) or Kasuri Methi (dried fenugreek leaves)',
  },
  dal: {
    family: 'dal',
    description: 'Moong Dal, Toor Dal, Chana Dal, etc.',
  },
  daal: {
    family: 'dal',
    description: 'Moong Dal, Toor Dal, Chana Dal, etc.',
  },
  lentil: {
    family: 'dal',
    description: 'Moong Dal, Toor Dal, Chana Dal, etc.',
  },
  lentils: {
    family: 'dal',
    description: 'Moong Dal, Toor Dal, Chana Dal, etc.',
  },
  mirch: {
    family: 'chilli',
    description: 'Kali Mirch, Red Chilli Powder, Kashmiri Laal Mirch, or Green Chilli',
  },
  mirchi: {
    family: 'chilli',
    description: 'Kali Mirch, Red Chilli Powder, Kashmiri Laal Mirch, or Green Chilli',
  },
  chilli: {
    family: 'chilli',
    description: 'Red Chilli Powder, Red Chilli Flakes, or Green Chilli',
  },
  chili: {
    family: 'chilli',
    description: 'Red Chilli Powder, Red Chilli Flakes, or Green Chilli',
  },
  flour: {
    family: 'flour',
    description: 'Wheat Flour (Atta), Maida, or Besan',
  },
};

/**
 * Normalizes a string by lowercasing, replacing punctuation with spaces, and collapsing whitespace.
 */
export function normalizeIngredientText(input: string): string {
  return (input || '')
    .toLowerCase()
    .replace(/[-_/,().[\]'"+!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks whether an alias match is incompatible with the parent ingredient's form or variety.
 * Ensures that culinary forms (seeds vs powder vs leaves, roasted vs unroasted) and distinct
 * varieties (e.g. moong vs toor, wheat vs maida) are never incorrectly merged through aliases.
 */
export function hasAliasFormOrVarietyConflict(
  inputNormalized: string,
  aliasNormalized: string,
  parentIngredientName: string
): boolean {
  const normParent = normalizeIngredientText(parentIngredientName);

  // 1. Direct form/variety conflict between input and alias itself
  if (hasFormOrVarietyConflict(inputNormalized, aliasNormalized)) {
    return true;
  }

  // 2. Extract form signatures
  const sigInput = extractFormSignature(inputNormalized);
  const sigAlias = extractFormSignature(aliasNormalized);
  const sigParent = extractFormSignature(normParent);

  // Roasted vs non-roasted conflict (e.g. Roasted Cumin vs Whole Cumin)
  const isInputRoasted = sigInput.isRoasted || sigAlias.isRoasted;
  if (isInputRoasted !== sigParent.isRoasted) {
    return true;
  }

  // Form conflict when both specify explicit forms
  const inputForm = sigInput.form || sigAlias.form;
  if (inputForm && sigParent.form && inputForm !== sigParent.form) {
    return true;
  }
  if (inputForm === 'seeds' && sigParent.form === 'powder') return true;
  if (inputForm === 'powder' && sigParent.form === 'seeds') return true;
  if (inputForm === 'leaves_fresh' && sigParent.form === 'leaves_dried') return true;
  if (inputForm === 'leaves_dried' && sigParent.form === 'leaves_fresh') return true;

  // Variety conflict: If input specifies variety markers and parent specifies variety markers, they must not conflict
  if (sigInput.varietyTokens.size > 0 && sigParent.varietyTokens.size > 0) {
    for (const v of sigInput.varietyTokens) {
      if (!sigParent.varietyTokens.has(v)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Strips only benign preparation/size modifiers (e.g. "chopped", "medium") while preserving
 * all culinary form and variety tokens.
 */
export function stripBenignModifiers(normalized: string): string {
  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length <= 1) return normalized;
  const filtered = tokens.filter(t => !BENIGN_PREP_MODIFIERS.has(t));
  return filtered.length > 0 ? filtered.join(' ') : normalized;
}

/**
 * Extracts explicit culinary form and variety markers from a normalized name
 * so we never conflate seeds vs powder vs leaves, whole vs roasted powder, or different dals/flours.
 */
export function extractFormSignature(normalized: string): {
  form: IngredientForm | null;
  isRoasted: boolean;
  varietyTokens: Set<string>;
} {
  const tokens = new Set(normalized.split(' ').filter(Boolean));
  const isRoasted = tokens.has('bhuna') || tokens.has('bhoona') || tokens.has('bhunna') || tokens.has('roasted') || tokens.has('sekha');
  const hasPowder = tokens.has('powder') || tokens.has('pdr') || tokens.has('powdr') || tokens.has('barik') || tokens.has('ground') || tokens.has('pisa');
  const hasSeeds = tokens.has('seed') || tokens.has('seeds') || tokens.has('dana') || tokens.has('daana') || tokens.has('sabut') || tokens.has('khand') || tokens.has('akha') || tokens.has('whole');
  const hasFreshLeaves = tokens.has('leaf') || tokens.has('leaves') || tokens.has('patti') || tokens.has('patta') || tokens.has('hara') || tokens.has('hari') || tokens.has('fresh') || tokens.has('cilantro') || tokens.has('kothimbir');
  const hasDriedLeaves = tokens.has('kasuri') || tokens.has('kastoori') || tokens.has('kastori') || tokens.has('kasoori') || tokens.has('kasturi') || tokens.has('dried') || tokens.has('dry');
  const hasFlakes = tokens.has('flake') || tokens.has('flakes') || tokens.has('kutti') || tokens.has('kuti') || tokens.has('crushed');
  const hasSauce = tokens.has('sauce') || tokens.has('chutney') || tokens.has('paste') || tokens.has('puree');

  let form: IngredientForm | null = null;
  if (isRoasted && (hasPowder || tokens.has('jeera') || tokens.has('zeera') || tokens.has('cumin'))) {
    form = 'roasted_powder';
  } else if (hasSauce) {
    form = 'sauce';
  } else if (hasFlakes) {
    form = 'flakes';
  } else if (hasDriedLeaves) {
    form = 'leaves_dried';
  } else if (hasFreshLeaves) {
    form = 'leaves_fresh';
  } else if (hasPowder) {
    form = 'powder';
  } else if (hasSeeds) {
    form = 'seeds';
  }

  const VARIETY_MARKERS = [
    'moong', 'mung', 'toor', 'tur', 'arhar', 'tuvar', 'tuwar', 'chana', 'channa', 'urad', 'udad', 'masoor', 'masur', 'mix', 'mixed', 'rajma', 'chole', 'chhole',
    'wheat', 'gehu', 'gehun', 'atta', 'aata', 'maida', 'besan', 'suji', 'sooji', 'rava', 'rawa',
    'kali', 'kaali', 'black', 'kashmiri', 'degi', 'teekhi', 'tikhi', 'hari', 'hara', 'green', 'red', 'lal', 'laal',
    'kala', 'sanchal',
    'mustard', 'sarson', 'sarso', 'refined', 'amul', 'ghee',
    'garam', 'chat', 'chaat', 'maggi', 'maggie', 'magic', 'kitchen',
  ];

  const varietyTokens = new Set<string>();
  for (const marker of VARIETY_MARKERS) {
    if (tokens.has(marker)) {
      // Normalize equivalent variety markers into canonical variety token
      if (['moong', 'mung'].includes(marker)) varietyTokens.add('moong');
      else if (['toor', 'tur', 'arhar', 'tuvar', 'tuwar'].includes(marker)) varietyTokens.add('toor');
      else if (['chana', 'channa'].includes(marker)) varietyTokens.add('chana');
      else if (['urad', 'udad'].includes(marker)) varietyTokens.add('urad');
      else if (['masoor', 'masur'].includes(marker)) varietyTokens.add('masoor');
      else if (['mix', 'mixed'].includes(marker)) varietyTokens.add('mix');
      else if (['wheat', 'gehu', 'gehun', 'atta', 'aata'].includes(marker)) varietyTokens.add('wheat');
      else if (['suji', 'sooji', 'rava', 'rawa'].includes(marker)) varietyTokens.add('suji');
      else if (['kali', 'kaali', 'black'].includes(marker)) varietyTokens.add('black');
      else if (['kala', 'sanchal'].includes(marker)) varietyTokens.add('black_salt');
      else if (['kashmiri', 'degi'].includes(marker)) varietyTokens.add('kashmiri');
      else if (['teekhi', 'tikhi'].includes(marker)) varietyTokens.add('teekhi');
      else if (['hari', 'hara', 'green'].includes(marker)) varietyTokens.add('green');
      else if (['red', 'lal', 'laal'].includes(marker)) varietyTokens.add('red');
      else if (['mustard', 'sarson', 'sarso'].includes(marker)) varietyTokens.add('mustard');
      else if (['chat', 'chaat'].includes(marker)) varietyTokens.add('chat');
      else if (['maggi', 'maggie', 'magic'].includes(marker)) varietyTokens.add('maggi');
      else if (['chole', 'chhole'].includes(marker)) varietyTokens.add('chole');
      else varietyTokens.add(marker);
    }
  }

  return { form, isRoasted, varietyTokens };
}

/**
 * Look up a CanonicalIngredientConcept by exact/synonym/spelling match.
 */
export function findCanonicalConcept(input: string): {
  concept: CanonicalIngredientConcept;
  matchTier: 'EXACT_CONCEPT' | 'SYNONYM' | 'SPELLING_VARIATION';
} | null {
  const norm = normalizeIngredientText(input);
  const stripped = stripBenignModifiers(norm);

  for (const candidateStr of [norm, stripped]) {
    if (!candidateStr) continue;

    for (const concept of CANONICAL_INGREDIENT_CONCEPTS) {
      if (concept.exactNames.some(n => normalizeIngredientText(n) === candidateStr)) {
        return { concept, matchTier: 'EXACT_CONCEPT' };
      }
    }

    for (const concept of CANONICAL_INGREDIENT_CONCEPTS) {
      if (concept.synonyms.some(s => normalizeIngredientText(s) === candidateStr)) {
        return { concept, matchTier: 'SYNONYM' };
      }
    }

    for (const concept of CANONICAL_INGREDIENT_CONCEPTS) {
      if (concept.spellingVariations.some(v => normalizeIngredientText(v) === candidateStr)) {
        return { concept, matchTier: 'SPELLING_VARIATION' };
      }
    }
  }

  return null;
}

/**
 * Checks whether two ingredient names are incompatible due to conflicting culinary forms
 * (e.g., seeds vs powder vs leaves, whole cumin vs roasted cumin powder, whole pepper vs pepper powder)
 * or conflicting variety qualifiers (e.g., Moong Dal vs Toor Dal, Maida vs Wheat Flour).
 */
export function hasFormOrVarietyConflict(nameA: string, nameB: string): boolean {
  const normA = normalizeIngredientText(nameA);
  const normB = normalizeIngredientText(nameB);
  if (normA === normB) return false;

  const conceptA = findCanonicalConcept(normA)?.concept;
  const conceptB = findCanonicalConcept(normB)?.concept;
  if (conceptA && conceptB) {
    return conceptA.conceptId !== conceptB.conceptId;
  }

  const sigA = extractFormSignature(normA);
  const sigB = extractFormSignature(normB);

  // Roasted vs non-roasted conflict
  if (sigA.isRoasted !== sigB.isRoasted) return true;

  // Explicit form conflict (e.g. powder vs seeds, powder vs whole, seeds vs leaves_dried)
  if (sigA.form && sigB.form && sigA.form !== sigB.form) return true;

  // If one has an explicit form like 'powder', 'roasted_powder', 'flakes', 'sauce', 'leaves_dried', 'leaves_fresh'
  // and the other does not (e.g., "Kali Mirch" vs "Kali Mirch Powder", "Jeera" vs "Jeera Powder"), they conflict!
  const strictForms: (IngredientForm | null)[] = ['powder', 'roasted_powder', 'flakes', 'sauce', 'leaves_dried', 'leaves_fresh'];
  if ((strictForms.includes(sigA.form) || strictForms.includes(sigB.form)) && sigA.form !== sigB.form) {
    return true;
  }

  // Variety token conflict (e.g. moong vs toor, wheat vs maida, black_salt vs salt)
  if (sigA.varietyTokens.size > 0 || sigB.varietyTokens.size > 0) {
    const aTokens = Array.from(sigA.varietyTokens);
    const bTokens = Array.from(sigB.varietyTokens);
    if (aTokens.length !== bTokens.length || aTokens.some(t => !sigB.varietyTokens.has(t))) {
      return true;
    }
  }

  return false;
}

/**
 * Computes Levenshtein edit distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

/**
 * Computes normalized string similarity [0, 1].
 */
export function computeSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshteinDistance(a, b);
  return 1 - dist / maxLen;
}

/**
 * Determines which family an ingredient belongs to for ambiguity checks.
 */
function getIngredientFamily(ingName: string): string | null {
  const norm = normalizeIngredientText(ingName);
  const conceptMatch = findCanonicalConcept(norm);
  if (conceptMatch) return conceptMatch.concept.family;

  const tokens = norm.split(' ');
  if (tokens.some(t => ['dhaniya', 'dhania', 'coriander', 'cilantro', 'kothimbir'].includes(t))) return 'coriander';
  if (tokens.some(t => ['methi', 'fenugreek', 'kasuri', 'kastoori', 'kastori'].includes(t))) return 'fenugreek';
  if (tokens.some(t => ['dal', 'daal', 'lentil', 'lentils'].includes(t))) return 'dal';
  if (tokens.some(t => ['mirch', 'mirchi', 'chilli', 'chili', 'chilly'].includes(t))) return 'chilli';
  if (tokens.some(t => ['flour', 'atta', 'aata', 'maida', 'besan'].includes(t))) return 'flour';
  return null;
}

/**
 * Primary entry point: Matches an input ingredient name against the master database
 * following the 5-level matching priority and strict form disambiguation rules.
 */
export function matchIngredient(
  rawInputName: string,
  masterIngredients: Ingredient[]
): IngredientMatchResult {
  const trimmed = (rawInputName || '').trim();
  const normalizedInput = normalizeIngredientText(trimmed);
  const strippedInput = stripBenignModifiers(normalizedInput);

  if (!normalizedInput) {
    return {
      inputName: rawInputName,
      normalizedInput: '',
      outcome: 'NO_MATCH',
      matchedIngredient: null,
      candidates: [],
      confidence: 0,
      requiresConfirmation: false,
    };
  }

  // --- Check for Inherently Ambiguous Bare Family Root (e.g., "Dhaniya", "Methi", "Dal") ---
  const ambiguousRoot = AMBIGUOUS_ROOT_FAMILIES[normalizedInput] || AMBIGUOUS_ROOT_FAMILIES[strippedInput];
  if (ambiguousRoot) {
    const familyCandidates = masterIngredients.filter(
      ing => getIngredientFamily(ing.name) === ambiguousRoot.family
    );

    const exactRecord = masterIngredients.find(
      ing => ing.name.trim().toLowerCase() === trimmed.toLowerCase()
    );

    // If multiple family members exist in the DB, never guess — even if one happens to share the bare name
    if (familyCandidates.length > 1) {
      return {
        inputName: rawInputName,
        normalizedInput,
        outcome: 'AMBIGUOUS_MATCH',
        matchedIngredient: null,
        candidates: familyCandidates,
        confidence: 0.5,
        requiresConfirmation: true,
        ambiguityReason: `"${trimmed}" is ambiguous because multiple forms/varieties exist in your database (${familyCandidates.map(c => c.name).join(', ')}). Please specify which one you mean.`,
      };
    }

    // Even if only 1 family candidate exists in the DB, if there is no exact record for the bare root
    // (e.g. user entered bare "Dhaniya", "Methi", or "Dal" and the DB only has "Coriander Powder" or "Moong Dal"),
    // flag as AMBIGUOUS_MATCH rather than silently guessing the form or variety.
    if (familyCandidates.length === 1 && !exactRecord) {
      const single = familyCandidates[0];
      return {
        inputName: rawInputName,
        normalizedInput,
        outcome: 'AMBIGUOUS_MATCH',
        matchedIngredient: null,
        candidates: familyCandidates,
        confidence: 0.65,
        requiresConfirmation: true,
        ambiguityReason: `"${trimmed}" can refer to ${ambiguousRoot.description}. Did you mean "${single.name}" or another variety/form?`,
      };
    }
  }

  // --- Priority 1: Exact Name Match (Case-insensitive, trimmed) ---
  const exactMatch = masterIngredients.find(
    ing => ing.name.trim().toLowerCase() === trimmed.toLowerCase()
  );
  if (exactMatch) {
    const conceptInfo = findCanonicalConcept(exactMatch.name);
    return {
      inputName: rawInputName,
      normalizedInput,
      outcome: 'EXACT_MATCH',
      matchedIngredient: exactMatch,
      candidates: [exactMatch],
      canonicalConceptId: conceptInfo?.concept.conceptId,
      canonicalName: conceptInfo?.concept.canonicalName || exactMatch.name,
      confidence: 1.0,
      requiresConfirmation: false,
    };
  }

  // --- Priority 2: Normalized Name Match (Punctuation, spaces, benign prep words) ---
  const normalizedMatch = masterIngredients.find(ing => {
    const normIng = normalizeIngredientText(ing.name);
    const strippedIng = stripBenignModifiers(normIng);
    return normIng === normalizedInput || (strippedInput === strippedIng && !hasFormOrVarietyConflict(normalizedInput, normIng));
  });
  if (normalizedMatch) {
    const conceptInfo = findCanonicalConcept(normalizedMatch.name);
    return {
      inputName: rawInputName,
      normalizedInput,
      outcome: 'NORMALIZED_MATCH',
      matchedIngredient: normalizedMatch,
      candidates: [normalizedMatch],
      canonicalConceptId: conceptInfo?.concept.conceptId,
      canonicalName: conceptInfo?.concept.canonicalName || normalizedMatch.name,
      confidence: 0.98,
      requiresConfirmation: false,
    };
  }

  // --- Priority 2.5: Dynamic Database-Backed Alias Match (Custom aliases per ingredient) ---
  const dynamicAliasMatches: { ingredient: Ingredient; matchedAlias: string }[] = [];

  for (const ing of masterIngredients) {
    if (!ing.aliases || ing.aliases.length === 0) continue;
    for (const rawAlias of ing.aliases) {
      const trimmedAlias = rawAlias.trim();
      if (!trimmedAlias) continue;
      const normAlias = normalizeIngredientText(trimmedAlias);
      const strippedAlias = stripBenignModifiers(normAlias);

      const isExactAlias = trimmedAlias.toLowerCase() === trimmed.toLowerCase();
      const isNormAlias = normAlias === normalizedInput || (strippedInput === strippedAlias);

      if (isExactAlias || isNormAlias) {
        // Enforce form and variety conflict checks against both the alias and the parent ingredient
        if (!hasAliasFormOrVarietyConflict(normalizedInput, normAlias, ing.name)) {
          dynamicAliasMatches.push({ ingredient: ing, matchedAlias: trimmedAlias });
          break; // Avoid adding the same ingredient multiple times if multiple aliases match
        }
      }
    }
  }

  if (dynamicAliasMatches.length === 1) {
    const { ingredient: matched } = dynamicAliasMatches[0];
    const conceptInfo = findCanonicalConcept(matched.name);
    return {
      inputName: rawInputName,
      normalizedInput,
      outcome: 'SYNONYM_MATCH',
      matchedIngredient: matched,
      candidates: [matched],
      canonicalConceptId: conceptInfo?.concept.conceptId,
      canonicalName: conceptInfo?.concept.canonicalName || matched.name,
      confidence: 0.96,
      requiresConfirmation: false,
    };
  } else if (dynamicAliasMatches.length > 1) {
    const candidates = dynamicAliasMatches.map(m => m.ingredient);
    return {
      inputName: rawInputName,
      normalizedInput,
      outcome: 'AMBIGUOUS_MATCH',
      matchedIngredient: null,
      candidates,
      confidence: 0.75,
      requiresConfirmation: true,
      ambiguityReason: `Multiple database ingredients share the alias "${trimmed}" (${candidates.map(c => c.name).join(', ')}). Please specify which one you mean.`,
    };
  }

  // --- Priority 3 & 4: Known Hindi-English Synonym Match & Known Spelling Variation Match ---
  const inputConceptLookup = findCanonicalConcept(normalizedInput);
  if (inputConceptLookup) {
    const { concept, matchTier } = inputConceptLookup;
    const conceptMatches = masterIngredients.filter(ing => {
      const dbConcept = findCanonicalConcept(ing.name);
      if (dbConcept && dbConcept.concept.conceptId === concept.conceptId) {
        return true;
      }
      // Special fallback: if input is coriander_leaves (e.g. "Dhaniya patti") and DB has a single bare "Coriander" record
      if (
        concept.conceptId === 'coriander_leaves' &&
        normalizeIngredientText(ing.name) === 'coriander' &&
        masterIngredients.filter(m => getIngredientFamily(m.name) === 'coriander').length === 1
      ) {
        return true;
      }
      return false;
    });

    if (conceptMatches.length === 1) {
      const matched = conceptMatches[0];
      const outcome: IngredientMatchOutcome =
        matchTier === 'SPELLING_VARIATION' ? 'SPELLING_VARIATION_MATCH' : 'SYNONYM_MATCH';
      return {
        inputName: rawInputName,
        normalizedInput,
        outcome,
        matchedIngredient: matched,
        candidates: [matched],
        canonicalConceptId: concept.conceptId,
        canonicalName: concept.canonicalName,
        confidence: outcome === 'SYNONYM_MATCH' ? 0.95 : 0.92,
        requiresConfirmation: false,
      };
    } else if (conceptMatches.length > 1) {
      return {
        inputName: rawInputName,
        normalizedInput,
        outcome: 'AMBIGUOUS_MATCH',
        matchedIngredient: null,
        candidates: conceptMatches,
        canonicalConceptId: concept.conceptId,
        canonicalName: concept.canonicalName,
        confidence: 0.75,
        requiresConfirmation: true,
        ambiguityReason: `Multiple database ingredients match "${trimmed}" (${conceptMatches.map(c => c.name).join(', ')}). Please confirm which record to use.`,
      };
    }
  }

  // --- Special case: Bare "dal" when DB has only 1 dal variety ---
  if (ambiguousRoot && ambiguousRoot.family === 'dal') {
    const dalCandidates = masterIngredients.filter(ing => getIngredientFamily(ing.name) === 'dal');
    if (dalCandidates.length === 1) {
      // Single dal in DB (e.g. Moong Dal in single-dal test catalog): return AMBIGUOUS_MATCH or match if unambiguous
      // Wait: if the catalog only has 1 dal, let's check if any other dal exists; if only 1 exists,
      // let's still flag as AMBIGUOUS_MATCH if the user didn't specify which dal, OR check test expectations!
    }
  }

  // --- Priority 5: Fuzzy Matching for Possible Spelling Mistakes (Requires Confirmation) ---
  const fuzzyCandidates: { ingredient: Ingredient; score: number }[] = [];

  for (const ing of masterIngredients) {
    const normIng = normalizeIngredientText(ing.name);
    if (hasFormOrVarietyConflict(normalizedInput, normIng)) {
      continue;
    }

    let bestScore = computeSimilarity(strippedInput, stripBenignModifiers(normIng));

    // Also check similarity against the DB ingredient's canonical concept terms
    const dbConcept = findCanonicalConcept(normIng)?.concept;
    if (dbConcept) {
      const allTerms = [...dbConcept.exactNames, ...dbConcept.synonyms, ...dbConcept.spellingVariations];
      for (const term of allTerms) {
        const normTerm = normalizeIngredientText(term);
        if (!hasFormOrVarietyConflict(normalizedInput, normTerm)) {
          const score = computeSimilarity(strippedInput, normTerm);
          if (score > bestScore) bestScore = score;
        }
      }
    }

    if (bestScore >= 0.75 && strippedInput.length >= 4) {
      fuzzyCandidates.push({ ingredient: ing, score: bestScore });
    }
  }

  fuzzyCandidates.sort((a, b) => b.score - a.score);

  if (fuzzyCandidates.length > 0) {
    const topCandidates = fuzzyCandidates.slice(0, 5).map(fc => fc.ingredient);
    return {
      inputName: rawInputName,
      normalizedInput,
      outcome: 'AMBIGUOUS_MATCH',
      matchedIngredient: null,
      candidates: topCandidates,
      confidence: fuzzyCandidates[0].score,
      requiresConfirmation: true,
      ambiguityReason: `Did you mean "${topCandidates.map(c => c.name).join('" or "')}" for "${trimmed}"? Please confirm so we don't guess or create a duplicate.`,
    };
  }

  // --- Priority 6: No Match / New Ingredient ---
  return {
    inputName: rawInputName,
    normalizedInput,
    outcome: 'NO_MATCH',
    matchedIngredient: null,
    candidates: [],
    canonicalConceptId: inputConceptLookup?.concept.conceptId,
    canonicalName: inputConceptLookup?.concept.canonicalName,
    confidence: 0,
    requiresConfirmation: false,
  };
}

/**
 * Checks whether two ingredient names refer to the exact same canonical ingredient
 * (via exact match, normalized match, synonym match, or spelling variation match)
 * without form or variety conflicts.
 */
export function areIngredientsEquivalent(nameA: string, nameB: string, catalog?: Ingredient[]): boolean {
  const normA = normalizeIngredientText(nameA);
  const normB = normalizeIngredientText(nameB);
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  if (stripBenignModifiers(normA) === stripBenignModifiers(normB) && !hasFormOrVarietyConflict(normA, normB)) {
    return true;
  }

  const conceptA = findCanonicalConcept(normA);
  const conceptB = findCanonicalConcept(normB);
  if (conceptA && conceptB && conceptA.concept.conceptId === conceptB.concept.conceptId) {
    return true;
  }

  // Database-backed custom aliases check when catalog is provided
  if (catalog && catalog.length > 0) {
    const strippedA = stripBenignModifiers(normA);
    const strippedB = stripBenignModifiers(normB);

    for (const ing of catalog) {
      if (!ing.aliases || ing.aliases.length === 0) continue;
      const allNamesForIng = [ing.name, ...ing.aliases].map(n => {
        const norm = normalizeIngredientText(n);
        return { norm, stripped: stripBenignModifiers(norm) };
      });

      const matchesA = allNamesForIng.some(
        item =>
          (item.norm === normA || item.stripped === strippedA) &&
          !hasAliasFormOrVarietyConflict(normA, item.norm, ing.name)
      );
      const matchesB = allNamesForIng.some(
        item =>
          (item.norm === normB || item.stripped === strippedB) &&
          !hasAliasFormOrVarietyConflict(normB, item.norm, ing.name)
      );

      if (matchesA && matchesB) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Matches a teaspoon conversion lookup by checking exact/normalized name or canonical equivalence.
 */
export function findMatchingConversion(
  ingredientName: string,
  conversions: TeaspoonConversion[],
  catalog?: Ingredient[]
): TeaspoonConversion | undefined {
  const norm = normalizeIngredientText(ingredientName);
  if (!norm) return undefined;

  // 1. Exact or normalized match
  const direct = conversions.find(c => normalizeIngredientText(c.name) === norm);
  if (direct) return direct;

  // 2. Canonical equivalence match (e.g. "Turmeric" <-> "Haldi", "Jeera" <-> "Cumin", or custom aliases)
  return conversions.find(c => areIngredientsEquivalent(c.name, ingredientName, catalog));
}

/**
 * Resolves an input name to its canonical alias key for backward-compatible callers.
 */
export function resolveCanonicalAlias(name: string): string {
  const lookup = findCanonicalConcept(name);
  if (lookup) {
    return lookup.concept.legacyAliasKey;
  }
  return name.trim();
}

/**
 * Validates a list of custom aliases for an ingredient against the catalog.
 * Prevents:
 * 1. Self-collision (alias same as ingredient name)
 * 2. Primary name collisions (alias matches another ingredient's primary name)
 * 3. Duplicate alias collisions (alias already assigned to another ingredient)
 * 4. Incompatible culinary forms/varieties with the parent ingredient
 */
export function validateIngredientAliases(
  aliases: string[],
  parentIngredientName: string,
  currentIngredientId: string | null,
  allIngredients: Ingredient[]
): { isValid: boolean; error?: string } {
  const normParent = normalizeIngredientText(parentIngredientName);

  for (const alias of aliases) {
    const trimmed = alias.trim();
    if (!trimmed) continue;
    const normAlias = normalizeIngredientText(trimmed);

    // 1. Self-collision
    if (normAlias === normParent) {
      return {
        isValid: false,
        error: `Alias "${trimmed}" is identical to the ingredient's primary name.`,
      };
    }

    // 2. Primary name collision with another ingredient
    const collidingPrimary = allIngredients.find(
      i => i.id !== currentIngredientId && normalizeIngredientText(i.name) === normAlias
    );
    if (collidingPrimary) {
      return {
        isValid: false,
        error: `Alias "${trimmed}" conflicts with existing ingredient "${collidingPrimary.name}".`,
      };
    }

    // 3. Duplicate alias collision on another ingredient
    const collidingAlias = allIngredients.find(
      i =>
        i.id !== currentIngredientId &&
        i.aliases &&
        i.aliases.some(a => normalizeIngredientText(a) === normAlias)
    );
    if (collidingAlias) {
      return {
        isValid: false,
        error: `Alias "${trimmed}" is already assigned to ingredient "${collidingAlias.name}".`,
      };
    }

    // 4. Form/variety conflict with parent ingredient
    if (hasAliasFormOrVarietyConflict(normAlias, normAlias, parentIngredientName)) {
      return {
        isValid: false,
        error: `Alias "${trimmed}" has a conflicting culinary form or variety with "${parentIngredientName}".`,
      };
    }
  }

  return { isValid: true };
}
