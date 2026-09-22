import { SignIn } from '@clerk/nextjs';

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <SignIn routing="path" path="/login" />
    </main>
  );
}
