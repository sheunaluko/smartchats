'use client';

import React from 'react';
import { Button } from '../Button';
import { Input } from '../Input';
import { Modal } from '../Modal';
import { FieldGroup } from './FieldGroup';

type AuthDialogProps = {
  open: boolean;
  onClose: () => void;
  email: string;
  password: string;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  /** Sign-in handlers are optional — when absent, the corresponding button/field is hidden. */
  onGoogleSignIn?: () => void;
  onAnonymousSignIn?: () => void;
  onEmailSignIn?: () => void;
  onEmailSignUp?: () => void;
};

export function AuthDialog({
  open,
  onClose,
  email,
  password,
  onEmailChange,
  onPasswordChange,
  onGoogleSignIn,
  onAnonymousSignIn,
  onEmailSignIn,
  onEmailSignUp,
}: AuthDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Welcome back"
      description="Sign in to sync sessions, use cloud storage, and keep SmartChats consistent across devices."
      size="sm"
    >
      <div className="space-y-4">
        {onGoogleSignIn && (
          <Button variant="solid" className="w-full justify-center" onClick={onGoogleSignIn}>
            Continue with Google
          </Button>
        )}

        {onAnonymousSignIn && (
          <div className="rounded-sc border border-sc-border/60 bg-sc-surface-alt/50 px-3 py-2 text-center">
            <button
              onClick={onAnonymousSignIn}
              className="text-sm font-medium text-sc-text-muted transition-colors duration-sc-fast hover:text-sc-text"
            >
              Continue anonymously
            </button>
            <div className="mt-1 text-xs text-sc-text-muted/80">Best for quick local-only prototyping.</div>
          </div>
        )}

        {(onEmailSignIn || onEmailSignUp) && (
          <FieldGroup
            label="Email sign-in"
            description="Use email and password if you want a direct account instead of Google auth."
          >
            <div className="space-y-3">
              <Input
                type="email"
                label="Email"
                value={email}
                onChange={(event) => onEmailChange(event.target.value)}
                placeholder="you@example.com"
              />
              <Input
                type="password"
                label="Password"
                value={password}
                onChange={(event) => onPasswordChange(event.target.value)}
                placeholder="Enter your password"
              />
              <div className="grid grid-cols-2 gap-2">
                {onEmailSignIn && (
                  <Button variant="soft" className="justify-center" onClick={onEmailSignIn}>
                    Sign In
                  </Button>
                )}
                {onEmailSignUp && (
                  <Button variant="ghost" className="justify-center" onClick={onEmailSignUp}>
                    Create Account
                  </Button>
                )}
              </div>
            </div>
          </FieldGroup>
        )}
      </div>
    </Modal>
  );
}
