import { NewListingForm } from "./NewListingForm";

export const dynamic = "force-dynamic";

export default function NewListingPage() {
  return (
    <main className="mx-auto max-w-2xl">
      <h1 className="font-display text-h1 font-semibold">New listing</h1>
      <p className="mt-1 text-sm text-text-muted">
        A listing is a seller-side property you're representing pre-contract.
        Convert it to a transaction when an offer is accepted.
      </p>
      <div className="mt-6">
        <NewListingForm />
      </div>
    </main>
  );
}
