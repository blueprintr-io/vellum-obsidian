// Resolves `obsidian` to the in-memory stand-in for unit tests.
import { register } from 'node:module';

register('./loader.mjs', import.meta.url);
