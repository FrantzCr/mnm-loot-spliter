import { PersonView } from "@/components/person-view";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PersonView id={id} />;
}
