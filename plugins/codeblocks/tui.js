import { BoxRenderable } from "@opentui/core"

// V2 paints fenced code with the message background and themes have no
// code-block token, so wrap each block in a tinted box instead.
// ponytail: only listed languages get the box (OpenTUI renderers are keyed by
// language; unlabeled ``` blocks can't be matched). Add names as needed.
const BG = "#16171c"
const LANGUAGES = `javascript javascriptreact typescript typescriptreact json jsonc python ruby go rust java
  kotlin swift c cpp csharp php bash fish lua sql html css scss markdown yaml toml xml dockerfile make diff
  elixir haskell scala dart vue svelte gd zig nix ini txt text console shell graphql proto tf`.split(/\s+/)

export default {
  id: "codeblocks",
  setup(context) {
    const render = (_token, ctx) => {
      const code = ctx.defaultRender()
      if (!code) return null
      code.bg = BG
      const box = new BoxRenderable(context.renderer, {
        backgroundColor: BG,
        paddingLeft: 1,
        paddingRight: 1,
        width: "100%",
        marginBottom: 1,
      })
      box.add(code)
      return box
    }
    const off = LANGUAGES.map((lang) => context.markdown.registerCodeBlockRenderer(lang, render))
    return () => off.forEach((fn) => fn())
  },
}
