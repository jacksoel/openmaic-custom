import { LoginForm } from '@/components/auth/login-form';

export const metadata = {
  title: 'Sign In — OpenMAIC',
  description: 'Sign in to your OpenMAIC account',
};

export default function LoginPage() {
  return <LoginForm />;
}