import { type Todo, updateTodoText } from "./todo-store";

export type TodoEditState = {
  editingId: string | null;
  draft: string;
};

export function beginTodoEdit(todo: Todo): TodoEditState {
  return {
    editingId: todo.id,
    draft: todo.text
  };
}

export function cancelTodoEdit(): TodoEditState {
  return {
    editingId: null,
    draft: ""
  };
}

export function commitTodoEdit(todos: Todo[], editingId: string | null, draft: string): {
  todos: Todo[];
  editingId: string | null;
  draft: string;
} {
  return {
    todos: editingId !== null ? updateTodoText(todos, editingId, draft) : todos,
    ...cancelTodoEdit()
  };
}
