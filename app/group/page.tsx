import { Suspense } from "react";

import { GroupScreen } from "@/components/group-screen";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <GroupScreen />
    </Suspense>
  );
}
