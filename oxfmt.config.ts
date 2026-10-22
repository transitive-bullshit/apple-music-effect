import shared from '@fisch0920/config/oxfmt'
import { defineConfig } from 'oxfmt'

export default defineConfig({
  ...shared,
  // the Python analysis writes the timeline; commit it byte for byte
  ignorePatterns: [...(shared.ignorePatterns ?? []), 'data/timeline.json']
})
