import { Text } from "react-native";
import { RequestError } from "@/api/transport";
import { confirmAction } from "./feedback";
import { Button, Card } from "./ui";
export function isEditConflict(error: unknown) {
  return error instanceof RequestError && (error.status === 409 || error.status === 428);
}
export function EditConflict({
  onReload,
  busy = false,
}: {
  onReload: () => Promise<unknown>;
  busy?: boolean;
}) {
  return (
    <Card>
      <Text accessibilityRole="alert">
        This work changed in another session. Your unsaved edits are still here.
      </Text>
      <Button
        label="Reload latest"
        secondary
        onPress={
          busy
            ? undefined
            : () => {
                void (async () => {
                  if (
                    await confirmAction(
                      "Reload latest saved version?",
                      "Reloading replaces your unsaved edits. Keep editing to retain them, or reload to review the latest saved work.",
                      "Reload latest",
                      "Keep editing",
                    )
                  )
                    await onReload();
                })().catch(() => undefined);
              }
        }
      />
    </Card>
  );
}
