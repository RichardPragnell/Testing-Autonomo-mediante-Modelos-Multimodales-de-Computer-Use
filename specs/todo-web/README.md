# Todo Web Contract

This directory is the framework-agnostic source of truth for the benchmark todo app.

Use [contract.json](/c:/Projects/master/specs/todo-web/contract.json) when building another implementation in Vue, Svelte, Angular, Next, Solid, or any other web stack.

What must stay identical across implementations:

- seeded todo data and summary text
- scenario ids, task instructions, and expected outcomes
- capability ids and heal case ids
- logical bug pack ids and their expected failing tasks
- accessible labels, button text, and automation hook attributes

What can vary:

- component/file structure
- CSS and layout details
- state management approach
- unique id generation strategy for newly created todos

Porting rules:

1. Keep the app single-page and local-only.
2. Reset to the same seeded state on reload.
3. Preserve the exact visible copy in the contract unless a future spec version changes it for every framework.
4. Recreate each bug pack as the same logical defect, even if the patch touches different files in different frameworks.

Practical split of responsibilities:

- `specs/todo-web/contract.json`: canonical behavior and benchmark contract
- `apps/<framework-app>/target.json`: local dev server and validation command for one implementation
- `apps/<framework-app>/benchmark.json`: framework-specific binding to the shared task and heal contract
- `apps/<framework-app>/bugs/<bugId>`: framework-specific patch implementing the shared bug semantics
