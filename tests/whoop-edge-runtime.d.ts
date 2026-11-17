// Type-check the actual Edge code against the installed Supabase client without
// installing another runtime or deploying anything. Not a runtime auth shim.
declare module 'jsr:@supabase/functions-js/edge-runtime.d.ts' {}
declare module 'jsr:@supabase/supabase-js@2' {
  export { createClient, type SupabaseClient } from '@supabase/supabase-js';
}
declare const Deno: {
  serve(handler:(request:Request) => Response | Promise<Response>):void;
  env:{get(name:string):string | undefined};
};
