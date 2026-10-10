declare module 'bsdiff-wasm' {
  type Module = {
    FS: { writeFile(path: string, data: Uint8Array): void; readFile(path: string): Uint8Array };
    callMain(args: string[]): number;
  };
  export function loadBsdiff(): Promise<Module>;
  export function loadBspatch(): Promise<Module>;
}
