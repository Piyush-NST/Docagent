import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <SignUp routing="path" path="/signup" />
    </main>
  );
}
