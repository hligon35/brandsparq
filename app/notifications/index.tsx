import { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { api } from "@/api/client";
import { registerThisDeviceForPush } from "@/notifications/register";
import { Button, Card, PageHeader, PageScroll, StatusBadge } from "@/components/ui";
import { colors, spacing } from "@/theme/tokens";

export default function NotificationsScreen(){
  const [items,setItems]=useState<any[]>([]);
  async function load(){setItems((await api.getNotifications()).data);}
  useEffect(()=>{void load();},[]);
  async function test(){try{await api.testNotifications();Alert.alert("Test sent","BrandSparQ queued a test notification.");await load();}catch(e){Alert.alert("Unable to test",e instanceof Error?e.message:"Try again.");}}
  async function enablePush(){
    try{
      const token=await registerThisDeviceForPush();
      Alert.alert("Push enabled",`This device is registered for BrandSparQ alerts.\n\n${token.slice(0,24)}…`);
    }catch(e){
      Alert.alert("Unable to enable push",e instanceof Error?e.message:"Try again.");
    }
  }
  return <PageScroll>
    <PageHeader eyebrow="Alerts" title="Notifications" subtitle="Review delivery, pre-publish alerts, publishing confirmations, and failures." action={<View style={styles.actions}><Button label="Enable push" small secondary onPress={enablePush}/><Button label="Send test" small secondary onPress={test}/></View>} />
    <View style={styles.list}>
      {items.map(item=><Card key={item.id}>
        <View style={styles.row}><StatusBadge label={item.status}/><Text style={styles.time}>{new Date(item.created_at).toLocaleString()}</Text></View>
        <Text style={styles.title}>{item.title || item.type}</Text>
        {!!item.body && <Text style={styles.body}>{item.body}</Text>}
      </Card>)}
      {!items.length&&<Card subtle><Text style={styles.body}>No notifications yet.</Text></Card>}
    </View>
  </PageScroll>;
}
const styles=StyleSheet.create({
  actions:{flexDirection:"row",flexWrap:"wrap",gap:8},
  list:{gap:spacing.md},
  row:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:spacing.sm},
  time:{color:colors.muted,fontSize:12},
  title:{color:colors.text,fontSize:17,fontWeight:"900"},
  body:{color:colors.muted,lineHeight:21}
});
