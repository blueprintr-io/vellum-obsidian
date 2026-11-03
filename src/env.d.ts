declare module 'virtual:vellum-frame' {
  /** The editor frame's script. */
  export const script: string;
  /** Its stylesheet, with fonts as `url(vellum-font:<id>)` placeholders. */
  export const style: string;
  /** woff2 fonts by placeholder id, base64-encoded. */
  export const fonts: Record<string, string>;
  /** The Vellum core release the plugin was built from. */
  export const coreTag: string;
  export const coreCommit: string;
}
