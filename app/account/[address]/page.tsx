import { AccountConsole } from "@/components/AccountConsole";
import { isNetworkId } from "@/lib/networks";

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ address: string }>;
  searchParams: Promise<{ network?: string }>;
}) {
  const { address } = await params;
  const { network } = await searchParams;
  return <AccountConsole address={decodeURIComponent(address)} network={isNetworkId(network) ? network : "testnet"} />;
}
