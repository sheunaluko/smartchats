import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Terms of Service — SmartChats',
  description: 'Terms governing your use of SmartChats.',
};

const LAST_UPDATED = '2026-05-18';

export default function TermsOfServicePage() {
  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-2xl px-6 py-16 sm:py-24">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-white/60 hover:text-white/90 transition-colors mb-12"
        >
          <ArrowLeft size={14} />
          Back to smartchats.ai
        </Link>

        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight mb-3">
          Terms of Service
        </h1>
        <p className="text-sm text-white/50 mb-12">
          Last updated: {LAST_UPDATED}
        </p>

        <div className="space-y-8 text-base text-white/85 leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-white mb-2">1. Acceptance</h2>
            <p>
              These terms (&quot;Terms&quot;) govern your use of SmartChats and
              related services provided by Sattvic Systems LLC
              (&quot;SmartChats&quot;, &quot;we&quot;, &quot;us&quot;). By
              accessing or using the service you agree to these Terms. If you
              don&apos;t agree, don&apos;t use the service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">2. Eligibility</h2>
            <p>
              You must be at least 13 years old to use SmartChats. If you are
              under 18, you may only use the service with the involvement of a
              parent or legal guardian. By using the service, you represent
              that you meet these requirements and that the information you
              provide is accurate.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">3. The service</h2>
            <p>
              SmartChats provides a voice-native AI assistant, knowledge
              management, code execution sandbox, and related tools. The
              service relies on third-party AI models (e.g. from OpenAI,
              Anthropic, Google) whose responses may be inaccurate, biased,
              or incomplete. SmartChats is provided &quot;as is&quot; and
              features may change at any time.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">4. Your account</h2>
            <p>
              You&apos;re responsible for maintaining the security of your
              account credentials and for all activity that occurs under your
              account. Notify us immediately of any unauthorized access. We
              may suspend or terminate accounts that violate these Terms or
              that pose a security risk.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">5. Subscriptions, credits, and refunds</h2>
            <p className="mb-3">
              Paid subscriptions and credit packs are billed through Stripe.
              By subscribing, you authorize recurring charges until you
              cancel. Subscriptions renew monthly at the then-current rate;
              cancel any time via the in-app billing settings.
            </p>
            <p className="mb-3">
              Tier changes (upgrades, downgrades) take effect immediately
              with proration. Subscription cancellations take effect
              immediately by default; period-end cancellations are available
              via the Customer Portal.
            </p>
            <p>
              Credit packs are one-time purchases. Purchased credits expire
              six months after purchase. We don&apos;t generally offer refunds
              for credits already used or for partially-consumed subscription
              periods; contact us if you believe you were charged in error
              and we&apos;ll review case-by-case.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">6. Your content</h2>
            <p className="mb-3">
              You retain ownership of the content you create using SmartChats
              (conversations, knowledge graph entries, logs, metrics, code,
              etc.). To deliver the service we need limited rights to that
              content:
            </p>
            <p className="mb-3">
              You grant SmartChats a worldwide, royalty-free, non-exclusive
              license to host, store, process, transmit, and display your
              content solely to the extent necessary to provide the service
              to you. This license includes sending your content to
              third-party AI providers as part of generating responses, and
              persisting your knowledge graph across sessions. This license
              ends when you delete the content or close your account, except
              that backups may persist for up to 90 days before automatic
              expiry.
            </p>
            <p>
              You&apos;re responsible for the legality of content you submit.
              Don&apos;t submit content you don&apos;t have the right to
              share, or content that violates anyone else&apos;s rights.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">7. Acceptable use</h2>
            <p className="mb-3">
              Don&apos;t use SmartChats to:
            </p>
            <ul className="list-disc list-outside pl-6 space-y-1.5">
              <li>Violate any applicable law or anyone&apos;s legal rights</li>
              <li>Generate or distribute content that is illegal, infringing, malicious, or designed to harass</li>
              <li>Bypass rate limits, attempt to extract model weights, or otherwise interfere with the service</li>
              <li>Reverse engineer, scrape, or use the service to train competing AI systems without our written consent</li>
              <li>Share your account credentials or sell access to others</li>
              <li>Use SmartChats to provide professional advice (medical, legal, financial, etc.) without appropriate human review</li>
            </ul>
            <p className="mt-3">
              We may suspend or terminate accounts for misuse, and we may
              remove content that violates these Terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">8. Intellectual property</h2>
            <p>
              SmartChats, the SmartChats name and logo, the user interface,
              the codebase, and related materials are owned by Sattvic
              Systems LLC. Open-source components are licensed under their
              respective open-source licenses. Nothing in these Terms grants
              you any rights to our intellectual property other than the
              limited license to use the service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">9. Copyright (DMCA)</h2>
            <p>
              If you believe content on SmartChats infringes your copyright,
              send a written notice including: your contact information; a
              description of the copyrighted work and the location of the
              allegedly infringing content; a statement that you have a good-
              faith belief that use is unauthorized; a statement under
              penalty of perjury that the information is accurate and that
              you&apos;re the rights-holder or authorized to act on their
              behalf; and your physical or electronic signature. Send notices
              via the contact link below.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">10. Disclaimer of warranties</h2>
            <p>
              The service is provided &quot;as is&quot; and &quot;as
              available&quot;, without warranties of any kind, express or
              implied, including warranties of merchantability, fitness for a
              particular purpose, non-infringement, accuracy, or
              uninterrupted operation. AI-generated content may be incorrect;
              you should verify important information independently. Code
              executed in our sandbox runs at your own risk.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">11. Limitation of liability</h2>
            <p>
              To the maximum extent permitted by law, SmartChats and its
              officers, employees, and affiliates will not be liable for any
              indirect, incidental, special, consequential, exemplary, or
              punitive damages arising out of your use of or inability to use
              the service, including loss of data, profits, or business
              opportunity. Our total liability for any claim arising under
              these Terms will not exceed the greater of (a) the amounts you
              paid to SmartChats in the twelve months preceding the claim, or
              (b) one hundred US dollars ($100).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">12. Indemnification</h2>
            <p>
              You agree to indemnify and hold harmless SmartChats and its
              affiliates from any claims, damages, liabilities, or expenses
              (including reasonable attorneys&apos; fees) arising from your
              violation of these Terms, your content, or your misuse of the
              service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">13. Termination</h2>
            <p>
              You may stop using SmartChats and close your account at any
              time. We may suspend or terminate your access if you violate
              these Terms, fail to pay, or for legitimate business reasons.
              Provisions of these Terms that by their nature should survive
              termination (intellectual property, limitation of liability,
              indemnification, governing law) will survive.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">14. Governing law and disputes</h2>
            <p>
              These Terms are governed by the laws of the State of Missouri,
              USA, without regard to its conflict-of-laws rules. Any dispute
              arising from these Terms or your use of the service will be
              resolved exclusively in the state or federal courts located in
              Missouri, and you consent to personal jurisdiction there. If
              you&apos;re a consumer outside the US with mandatory local
              consumer protections, those rights still apply to the extent
              required by law.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">15. Changes to these Terms</h2>
            <p>
              We may update these Terms periodically. Material changes will
              be communicated by updating the &quot;Last updated&quot; date
              above and, when significant, via in-app notification or email.
              Continued use of the service after changes constitutes
              acceptance of the updated Terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">16. Privacy</h2>
            <p>
              Your privacy is important. See our{' '}
              <Link
                href="/privacy-policy"
                className="text-white hover:text-white/80 underline underline-offset-2"
              >
                Privacy Policy
              </Link>{' '}
              for details on how we handle your information.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">17. Contact</h2>
            <p>
              Questions about these Terms? Reach out via{' '}
              <Link
                href="/"
                className="text-white hover:text-white/80 underline underline-offset-2"
              >
                smartchats.ai
              </Link>
              .
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
