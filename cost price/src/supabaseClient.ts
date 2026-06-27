import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const createFallbackClient = () => {
  const fallbackResponse = { data: [], error: null };
  const query = {
    limit: function (_n: number) {
      return this;
    },
    then: function (onFulfilled: any, onRejected: any) {
      return Promise.resolve(fallbackResponse).then(onFulfilled, onRejected);
    },
    catch: function (onRejected: any) {
      return Promise.resolve(fallbackResponse).catch(onRejected);
    },
  } as any;

  return {
    from: (_table: string) => ({
      select: (_query: string) => query,
      upsert: async (_payload: any) => ({ data: null, error: null }),
      limit: function (_n: number) {
        return query;
      },
    }),
  };
};

const supabase = (() => {
  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('Supabase environment variables are not set. Please configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
    return createFallbackClient();
  }

  return createClient(supabaseUrl as string, supabaseAnonKey as string);
})();

export default supabase;
