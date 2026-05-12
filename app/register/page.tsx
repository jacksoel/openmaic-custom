import { RegisterForm } from '@/components/auth/register-form';

export const metadata = {
  title: 'Register — OpenMAIC',
  description: 'Create an OpenMAIC account',
};

export default function RegisterPage() {
  return <RegisterForm />;
}