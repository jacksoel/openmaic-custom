import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Forgot Password - OpenMAIC",
  description: "Reset your OpenMAIC password",
};

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
