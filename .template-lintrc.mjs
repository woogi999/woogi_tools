export default {
  extends: 'recommended',
  rules: {
    // `<details>` is interactive only in its `<summary>`; the disclosure body
    // is ordinary content, and putting controls in it is the whole point of a
    // collapsible settings group. The rule counts the whole element as one
    // control, so it reads every one of those as nesting.
    'no-nested-interactive': { ignoredTags: ['details'] },

    // Fires on a component invocation inside a role'd button (a tab, a radio)
    // because it cannot see what the component renders. In every case here it
    // renders a decorative `aria-hidden` span or canvas beside the text that
    // actually names the control, which is the pattern the rule is protecting.
    'require-presentational-children': false,
  },
};
