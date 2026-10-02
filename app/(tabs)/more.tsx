import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "@/auth/context";
import { Button, Card, Screen } from "@/components/ui";
import { colors, spacing } from "@/theme/tokens";

const items = [
  { label: "Clients & Brand Brain", href: "/clients" as const },
  { label: "Campaigns", href: null },
  { label: "Social connections", href: null },
  { label: "Notifications", href: null },
  { label: "Analytics", href: null },
  { label: "Settings", href: null },
];

export default function MoreScreen() {
  const { user, signOut } = useAuth();

  return (
    <Screen>
      <Text style={styles.title}>More</Text>
      <Text style={styles.sub}>{user?.email}</Text>
      <View style={styles.list}>
        {items.map((item) =>
          item.href ? (
            <Link key={item.label} href={item.href} asChild>
              <Pressable>
                <Card><Text style={styles.item}>{item.label}</Text></Card>
              </Pressable>
            </Link>
          ) : (
            <Card key={item.label}>
              <Text style={styles.item}>{item.label}</Text>
              <Text style={styles.coming}>Coming in the next integration phase</Text>
            </Card>
          )
        )}
      </View>
      <Button label="Sign out" secondary onPress={signOut} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title:{color:colors.text,fontSize:30,fontWeight:"800"},
  sub:{color:colors.muted,fontSize:14},
  list:{gap:spacing.md},
  item:{color:colors.text,fontSize:17,fontWeight:"700"},
  coming:{color:colors.muted,fontSize:12}
});
