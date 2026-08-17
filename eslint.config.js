import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // This app intentionally synchronizes local modal/editor drafts from
      // changing records. Those effects are bounded and do not form loops.
      'react-hooks/set-state-in-effect': 'off',
      // Component modules occasionally export tightly coupled helpers used by
      // legacy screens; splitting them solely for HMR adds indirection.
      'react-refresh/only-export-components': 'off',
    },
  },
])
