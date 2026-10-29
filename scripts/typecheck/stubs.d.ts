// Minimal type stand-ins for packages that can't be installed in the build sandbox.
// Used only by scripts/typecheck (checks our own code's contracts); real builds use the real packages.
/* eslint-disable @typescript-eslint/no-explicit-any */

// Event handler props get a contextual (any) type, as with real React, so only genuinely untyped callbacks
// (e.g. over untyped Supabase rows) are reported as implicit any.
type StubHandler = (e: any) => void;
interface StubDomAttrs {
  onChange?: StubHandler; onClick?: StubHandler; onInput?: StubHandler; onKeyDown?: StubHandler; onKeyUp?: StubHandler;
  onSubmit?: StubHandler; onBlur?: StubHandler; onFocus?: StubHandler; onPaste?: StubHandler; onMouseDown?: StubHandler;
  onMouseEnter?: StubHandler; onMouseLeave?: StubHandler; onPointerDown?: StubHandler; onScroll?: StubHandler; onLoad?: StubHandler;
  onError?: StubHandler; onDragOver?: StubHandler; onDrop?: StubHandler; onTouchStart?: StubHandler; onContextMenu?: StubHandler;
  ref?: any; [attr: string]: any;
}
declare namespace JSX {
  type Element = any;
  interface IntrinsicElements { [name: string]: StubDomAttrs }
  interface ElementChildrenAttribute { children: {} }
  interface IntrinsicAttributes { key?: any }
}

declare module 'react' {
  export type ReactNode = any;
  export type ReactElement = any;
  export type CSSProperties = Record<string, any>;
  export type FormEvent<T = any> = any;
  export type ChangeEvent<T = any> = any;
  export type KeyboardEvent<T = any> = any;
  export type MouseEvent<T = any> = any;
  export type ComponentProps<T = any> = any;
  export type SVGProps<T = any> = StubDomAttrs;
  export type HTMLAttributes<T = any> = StubDomAttrs;
  export type AnchorHTMLAttributes<T = any> = StubDomAttrs;
  export type ButtonHTMLAttributes<T = any> = StubDomAttrs & { type?: 'button' | 'submit' | 'reset'; disabled?: boolean; className?: string; children?: any };
  export type InputHTMLAttributes<T = any> = StubDomAttrs;
  export type SelectHTMLAttributes<T = any> = StubDomAttrs & { children?: any };
  export type TextareaHTMLAttributes<T = any> = StubDomAttrs;
  export type Dispatch<A> = (value: A) => void;
  export type SetStateAction<S> = S | ((prev: S) => S);
  export type RefObject<T> = { current: T };
  export type FC<P = {}> = (props: P) => any;
  export function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
  export function useEffect(effect: () => void | (() => void), deps?: readonly any[]): void;
  export function useLayoutEffect(effect: () => void | (() => void), deps?: readonly any[]): void;
  export function useMemo<T>(factory: () => T, deps: readonly any[]): T;
  export function useCallback<T extends (...args: any[]) => any>(fn: T, deps: readonly any[]): T;
  export function useRef<T>(initial: T): RefObject<T>;
  export function useRef<T>(initial: T | null): RefObject<T | null>;
  export function useId(): string;
  export function useTransition(): [boolean, (fn: () => void | Promise<void>) => void];
  export function useDeferredValue<T>(v: T): T;
  export function useOptimistic<S, A = any>(state: S, update?: (s: S, a: A) => S): [S, (a: A) => void];
  export function useActionState<S, P = any>(action: (state: Awaited<S>, payload: P) => S | Promise<S>, initial: Awaited<S>, permalink?: string): [Awaited<S>, (payload: P) => void, boolean];
  export function useSyncExternalStore<T>(subscribe: (cb: () => void) => () => void, get: () => T, getServer?: () => T): T;
  export interface Context<T> { Provider: any; Consumer: any; __t?: T }
  export function createContext<T>(v: T): Context<T>;
  export function useContext<T>(ctx: Context<T>): T;
  export function cache<T extends (...args: any[]) => any>(fn: T): T;
  export function startTransition(fn: () => void): void;
  export const Fragment: any;
  export const Suspense: any;
  const React: any;
  export default React;
}
declare module 'react/jsx-runtime' { export const jsx: any; export const jsxs: any; export const Fragment: any; }
declare module 'react-dom' { export function useFormStatus(): { pending: boolean; data: FormData | null }; export function createPortal(n: any, el: any): any; }
declare module 'react-dom/client' { export function createRoot(el: any): { render(n: any): void }; }

declare module 'server-only' {}

declare module 'next' {
  export type Metadata = Record<string, any>;
  export type Viewport = Record<string, any>;
  export type NextConfig = Record<string, any>;
  export namespace MetadataRoute { type Manifest = Record<string, any>; type Robots = Record<string, any>; type Sitemap = any[] }
}
declare module 'next/server' {
  export class NextRequest extends Request {
    nextUrl: URL & { clone(): URL & { pathname: string } };
    cookies: { get(n: string): { name: string; value: string } | undefined; getAll(): { name: string; value: string }[]; set(n: string, v: string): void; toString(): string };
  }
  export class NextResponse extends Response {
    static json(body: any, init?: ResponseInit): NextResponse;
    static next(init?: any): NextResponse;
    static redirect(url: string | URL, status?: number): NextResponse;
    static rewrite(url: string | URL, init?: any): NextResponse;
    cookies: { set(n: string, v: string, o?: any): void };
  }
  export function after(task: Promise<any> | (() => any)): void;
}
declare module 'next/headers' {
  export function cookies(): Promise<{ get(n: string): { name: string; value: string } | undefined; getAll(): { name: string; value: string }[]; set(n: string, v: string, o?: any): void; delete(n: string): void }>;
  export function headers(): Promise<Headers>;
}
declare module 'next/navigation' {
  export function redirect(url: string): never;
  export function notFound(): never;
  export function useRouter(): { push(h: string): void; replace(h: string): void; refresh(): void; back(): void; prefetch(h: string): void };
  export function usePathname(): string;
  export function useSearchParams(): URLSearchParams;
}
declare module 'next/cache' { export function revalidatePath(p: string, t?: 'page' | 'layout'): void; export function revalidateTag(t: string): void; }
declare module 'next/link' { const Link: (props: StubDomAttrs & { href: string; children?: any }) => any; export default Link; }

declare module '@supabase/supabase-js' {
  // Untyped Supabase (no generated Database type) returns `any` rows, like the real client.
  type Res = { data: any; error: any; count: number | null; status: number };
  interface QB extends PromiseLike<Res> {
    select(...a: any[]): QB; insert(...a: any[]): QB; update(...a: any[]): QB; upsert(...a: any[]): QB; delete(...a: any[]): QB;
    eq(...a: any[]): QB; neq(...a: any[]): QB; gt(...a: any[]): QB; gte(...a: any[]): QB; lt(...a: any[]): QB; lte(...a: any[]): QB;
    in(...a: any[]): QB; is(...a: any[]): QB; not(...a: any[]): QB; like(...a: any[]): QB; ilike(...a: any[]): QB; or(...a: any[]): QB;
    order(...a: any[]): QB; limit(...a: any[]): QB; range(...a: any[]): QB; single(): QB; maybeSingle(): QB; filter(...a: any[]): QB;
    match(...a: any[]): QB; contains(...a: any[]): QB; textSearch(...a: any[]): QB; csv(): QB;
  }
  export interface SupabaseClient {
    from(table: string): QB;
    rpc(fn: string, args?: Record<string, unknown>): QB;
    auth: any;
    storage: any;
    channel(name: string): any;
    removeChannel(c: any): any;
  }
  export function createClient(url: string, key: string, opts?: any): SupabaseClient;
}
declare module '@supabase/ssr' {
  import type { SupabaseClient } from '@supabase/supabase-js';
  export function createServerClient(url: string, key: string, opts: { cookieOptions?: Record<string, any>; cookies: { getAll(): any[]; setAll(list: { name: string; value: string; options?: any }[]): void } }): SupabaseClient;
  export function createBrowserClient(url: string, key: string, opts?: { cookieOptions?: Record<string, any> }): SupabaseClient;
}
declare module '@opennextjs/cloudflare' { export function defineCloudflareConfig(c: any): any; export function initOpenNextCloudflareForDev(): void; export function getCloudflareContext(): any; }

declare module '*.css';
declare namespace React { type ReactNode = any; type MouseEvent<T = any> = any; type ChangeEvent<T = any> = any; type FormEvent<T = any> = any; type KeyboardEvent<T = any> = any; type CSSProperties = Record<string, any> }
declare const process: { env: Record<string, string | undefined> };
