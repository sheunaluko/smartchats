import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Privacy Policy — SmartChats',
  description: 'How SmartChats handles your information.',
};

const LAST_UPDATED = '2026-05-18';

export default function PrivacyPolicyPage() {
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
          Privacy Policy
        </h1>
        <p className="text-sm text-white/50 mb-12">
          Last updated: {LAST_UPDATED}
        </p>

        <div className="space-y-8 text-base text-white/85 leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-white mb-2">Overview</h2>
            <p>
              SmartChats is operated by Sattvic Systems LLC. This policy
              explains what information SmartChats collects, how it&apos;s used,
              and the choices you have. We don&apos;t sell your information.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">Information we collect</h2>
            <p className="mb-3">
              To deliver the service, SmartChats collects:
            </p>
            <ul className="list-disc list-outside pl-6 space-y-1.5">
              <li>
                <strong className="text-white">Account information</strong> —
                email, display name, authentication provider (e.g. Google,
                Apple). Provided when you sign in.
              </li>
              <li>
                <strong className="text-white">Conversations and voice content</strong> —
                messages you type or speak, agent responses, and the transcripts
                produced from your voice.
              </li>
              <li>
                <strong className="text-white">Personal data graph</strong> —
                logs, metrics, knowledge-graph entities, todos, and other
                structured data you generate while using the agent.
              </li>
              <li>
                <strong className="text-white">Usage telemetry</strong> —
                event records (session IDs, function calls, latencies, errors)
                used internally to monitor performance and debug issues.
              </li>
              <li>
                <strong className="text-white">Billing information</strong> —
                if you subscribe or purchase credits, payment information is
                collected and processed by Stripe; we receive only metadata
                (customer ID, last 4 of card, billing email) and never see the
                full card number.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">How we use your information</h2>
            <p className="mb-3">
              We use what we collect to:
            </p>
            <ul className="list-disc list-outside pl-6 space-y-1.5">
              <li>Provide the core agent experience — answering, recalling, executing code, generating speech</li>
              <li>Persist your knowledge graph and history across sessions and devices</li>
              <li>Bill you accurately and detect abuse (rate limits, fraud signals)</li>
              <li>Improve reliability — diagnose errors, optimize latency</li>
              <li>Respond to your support requests</li>
            </ul>
            <p className="mt-3">
              We do not use your content to train SmartChats models or to train
              the upstream LLM providers&apos; models. Providers (OpenAI,
              Anthropic, Google) have their own zero-data-retention API contracts
              when used through our infrastructure.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">Service providers we share data with</h2>
            <p className="mb-3">
              We use trusted infrastructure providers to operate SmartChats.
              These providers process data on our behalf under contracts that
              prohibit independent use. We do not sell or rent your information
              to anyone.
            </p>
            <ul className="list-disc list-outside pl-6 space-y-1.5">
              <li>
                <strong className="text-white">LLM providers</strong> (OpenAI,
                Anthropic, Google) — receive the text of your conversations to
                generate responses. Used via API only; not training data.
              </li>
              <li>
                <strong className="text-white">Speech providers</strong> (OpenAI
                TTS) — receive text to be spoken aloud.
              </li>
              <li>
                <strong className="text-white">Stripe</strong> — handles all
                payments and subscription management. Their privacy policy
                applies to payment processing.
              </li>
              <li>
                <strong className="text-white">Google Cloud / Firebase</strong> —
                authentication, application hosting, and primary data storage.
              </li>
              <li>
                <strong className="text-white">Serper (or similar)</strong> — when
                the agent searches the web on your behalf, the query is sent to
                a search API.
              </li>
              <li>
                <strong className="text-white">Vercel</strong> — application
                hosting and edge delivery.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">Data storage and security</h2>
            <p>
              Data is stored in Google Cloud (Firestore and SurrealDB) with
              encryption in transit (TLS) and at rest. Access to production
              data is restricted to authorized personnel using strong
              authentication. We log access for audit purposes. No system is
              perfectly secure; in the event of a breach affecting your
              information we will notify you and relevant authorities as
              required by law.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">Data retention</h2>
            <p>
              Your data persists until you delete it or close your account.
              When you delete content via the app (logs, metrics, KG entries,
              sessions, etc.), it&apos;s removed from active databases.
              Operational backups may retain copies for up to 90 days before
              automatic expiry. Anonymized telemetry (no identifying fields)
              may be retained longer for product analytics.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">Your rights</h2>
            <p className="mb-3">
              Regardless of where you live, you can:
            </p>
            <ul className="list-disc list-outside pl-6 space-y-1.5">
              <li>
                <strong className="text-white">Access and export</strong> all
                your data at any time via <code className="text-blue-300 text-sm bg-white/5 px-1 rounded">smartchats data export</code>{' '}
                from our CLI or the in-app export option
              </li>
              <li>
                <strong className="text-white">Delete</strong> individual
                conversations, logs, metrics, KG entries, or your entire
                account from the app
              </li>
              <li>
                <strong className="text-white">Correct</strong> account
                information at any time
              </li>
              <li>
                <strong className="text-white">Opt out</strong> of usage
                telemetry by signing out of telemetry (contact us for help if
                this isn&apos;t available in your settings yet)
              </li>
            </ul>
            <p className="mt-3">
              If you&apos;re in the EU/UK (GDPR) or California (CCPA/CPRA), you
              additionally have the right to data portability, restriction of
              processing, and to file a complaint with your local data
              protection authority. Contact us to exercise any of these
              rights.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">Cookies and similar technologies</h2>
            <p>
              We use cookies and local browser storage for authentication
              (keeping you signed in via Firebase Auth) and to remember your
              preferences. We don&apos;t use third-party advertising or
              cross-site tracking cookies. Browser controls let you clear or
              disable cookies; doing so may impair the app&apos;s ability to
              keep you signed in.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">International transfers</h2>
            <p>
              SmartChats and our service providers operate primarily from the
              United States. By using SmartChats from outside the US, you
              acknowledge that your data may be transferred to and processed
              in the US under US law. Where required by EU/UK law, transfers
              rely on standard contractual clauses with our service providers.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">Children</h2>
            <p>
              SmartChats is not directed at children under 13. We don&apos;t
              knowingly collect information from anyone under 13. If you
              believe a child has provided information to us, contact us and
              we&apos;ll remove it.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">Changes to this policy</h2>
            <p>
              We may update this policy periodically. Material changes will be
              communicated by updating the &quot;Last updated&quot; date above
              and, when significant, via in-app notification or email.
              Continued use of the service after changes constitutes acceptance
              of the revised policy.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-white mb-2">Contact</h2>
            <p>
              Sattvic Systems LLC operates SmartChats. For questions about
              this policy, data requests, or privacy concerns, reach out via{' '}
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
