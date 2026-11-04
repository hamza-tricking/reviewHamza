// Must run before any Remotion module calls staticFile(): media is served under /public.
(window as unknown as { remotion_staticBase: string }).remotion_staticBase = "/public";
export {};
