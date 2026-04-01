import { type Todo, updateTodoText } from "./todo-store";

export function beginTodoEdit(todo: Todo) {
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

export function commitTodoEdit(todos: Todo[], editingId: string | null, draft: string) {
  return {
    todos: editingId ? updateTodoText(todos, editingId, draft) : todos,
    ...cancelTodoEdit()
  };
}
