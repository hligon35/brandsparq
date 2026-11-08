import { Text } from "react-native";
import { Button, Card } from "./ui";

export function EditorDraftNotice({
  editor,
  busy = false,
}: {
  editor: {
    notice: string;
    pending: boolean;
    restoreRecovered(): Promise<void>;
    discardRecovered(): Promise<void>;
  };
  busy?: boolean;
}) {
  if (!editor.notice) return null;
  return (
    <Card subtle>
      <Text accessibilityRole={editor.pending ? "alert" : undefined}>{editor.notice}</Text>
      {editor.pending && (
        <>
          <Button
            label="Restore recovered draft"
            secondary
            onPress={busy ? undefined : () => void editor.restoreRecovered()}
          />
          <Button
            label="Discard recovered draft"
            secondary
            onPress={busy ? undefined : () => void editor.discardRecovered()}
          />
        </>
      )}
    </Card>
  );
}
