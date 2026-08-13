'use client';

/* The root route only decides where to go; it never renders a splash screen. */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { HOME, getSession } from '@/lib/role';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.replace(getSession() ? HOME : '/login');
  }, [router]);

  return null;
}
