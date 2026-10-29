import { cookies } from "next/headers";
import Chat from "./chat";
import Login from "./login";
import { authConfigured, COOKIE_NAME, verifySession } from "./lib/auth.server";

export default async function Home() {
  const cookieStore = await cookies();
  if (!verifySession(cookieStore.get(COOKIE_NAME)?.value)) {
    return <Login configured={authConfigured()} />;
  }
  return <Chat />;
}
