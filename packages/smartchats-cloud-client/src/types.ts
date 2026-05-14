/**
 * Local re-export of `QuerySpec` to avoid a hard dependency on
 * `smartchats-database` from the cloud client. Both packages converged
 * on the same shape independently; we duplicate the type definition
 * (10 lines) rather than introducing a circular workspace dep.
 */

export interface QuerySpec {
    query: string;
    variables: Record<string, unknown>;
}
