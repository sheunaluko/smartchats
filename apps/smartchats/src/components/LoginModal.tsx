'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth';
import { toast_toast } from './Toast';
import { AuthDialog } from '../../app/ui/recipes/AuthDialog';

declare var window: any;

export default function LoginModal() {
  const { user, capabilities, signIn } = useAuth();

  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const onClose = useCallback(() => {
    setIsOpen(false);
    setEmail('');
    setPassword('');
  }, []);

  useEffect(() => {
    // Skip when the deployment doesn't require auth (self-hosted trusted mode).
    // window.openLoginModal stays undefined so callers get a harmless no-op.
    if (!capabilities.required) return;
    if (typeof window !== 'undefined') {
      window.openLoginModal = () => setIsOpen(true);
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete window.openLoginModal;
      }
    };
  }, [capabilities.required]);

  useEffect(() => {
    if (user && isOpen) {
      toast_toast({
        title: 'Successfully logged in.',
        description: '',
        duration: 2000,
        status: 'success',
        isClosable: true,
      });
      onClose();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('loginSuccess'));
      }
    }
  }, [user, isOpen, onClose]);

  // Render nothing when auth isn't required by the deployment.
  if (!capabilities.required) return null;

  function loginError(error: string) {
    toast_toast({
      title: 'Failed to log in.',
      description: error,
      duration: 3000,
      status: 'error',
      isClosable: true,
    });
  }

  const handleGoogleSignIn = () => {
    signIn('google').catch((error) => loginError((error as Error).message));
  };
  const handleEmailSignIn = () => {
    signIn('email', { email, password }).catch((error) => loginError((error as Error).message));
  };
  const handleEmailSignUp = () => {
    signIn('email', { email, password, signup: true }).catch((error) => loginError((error as Error).message));
  };

  if (!isOpen) return null;

  return (
    <AuthDialog
      open={isOpen}
      onClose={onClose}
      email={email}
      password={password}
      onEmailChange={setEmail}
      onPasswordChange={setPassword}
      // Only surface affordances the provider advertises.
      onGoogleSignIn={capabilities.methods.includes('google') ? handleGoogleSignIn : undefined}
      onEmailSignIn={capabilities.methods.includes('email') ? handleEmailSignIn : undefined}
      onEmailSignUp={capabilities.methods.includes('email') ? handleEmailSignUp : undefined}
    />
  );
}
