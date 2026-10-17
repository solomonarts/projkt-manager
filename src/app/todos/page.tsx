import { createClient } from '@/utils/supabase/server';
import { cookies } from 'next/headers';

type Todo = { id: string | number; name: string };

export default async function Page() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase.from('todos').select();
  const todos = (data ?? []) as Todo[];

  return (
    <main>
      <h1>Todos</h1>
      {error ? (
        <p role="alert">Could not load todos. Check that the `todos` table exists and that your account can read it.</p>
      ) : todos.length ? (
        <ul>
          {todos.map((todo) => (
            <li key={todo.id}>{todo.name}</li>
          ))}
        </ul>
      ) : (
        <p role="status">No todos found.</p>
      )}
    </main>
  );
}
