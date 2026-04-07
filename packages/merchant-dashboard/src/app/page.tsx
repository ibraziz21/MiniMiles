import { redirect } from "next/navigation";

// Root → redirect to dashboard (middleware handles auth guard)
export default function RootPage() {
  redirect("/dashboard");
}
