import { updateTodoText } from "./todo-store.js";

export function beginTodoEdit(todo) {
  return {
    editingId: todo.id,
    draft: todo.text
  };
}

export function cancelTodoEdit() {
  return {
    editingId: null,
    draft: ""
  };
}

export function commitTodoEdit(todos, editingId, draft) {
  return {
    todos: editingId ? updateTodoText(todos, editingId, draft) : todos,
    ...cancelTodoEdit()
  };
}
