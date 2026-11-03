const stub = new URL('../obsidian/obsidian.ts', import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier === 'obsidian') return next(stub, context);
  return next(specifier, context);
}
