import { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { api } from "@/api/client";
import { Button, Card, PageHeader, PageScroll } from "@/components/ui";
import { colors, spacing } from "@/theme/tokens";

export default function AnalyticsScreen(){
  const [data,setData]=useState<any>();
  const [syncing,setSyncing]=useState(false);
  async function load(){ setData((await api.getAnalyticsOverview()).data); }
  useEffect(()=>{void load();},[]);
  async function sync(){
    setSyncing(true);
    try{ await api.syncAnalytics(); await load(); }
    catch(e){Alert.alert("Analytics sync failed",e instanceof Error?e.message:"Try again.");}
    finally{setSyncing(false);}
  }
  const o=data?.overview||{};
  const cards=[["Published posts",o.posts],["Impressions",o.impressions],["Reach",o.reach],["Likes",o.likes],["Comments",o.comments],["Shares",o.shares],["Clicks",o.clicks],["Saves",o.saves]];
  return <PageScroll>
    <PageHeader eyebrow="Performance" title="Analytics" subtitle="Latest available engagement metrics from connected social accounts." action={<Button label={syncing?"Syncing…":"Sync now"} small onPress={syncing?undefined:sync}/>} />
    <View style={styles.grid}>
      {cards.map(([label,value])=><Card key={label} style={styles.metricCard}><Text style={styles.value}>{Number(value||0).toLocaleString()}</Text><Text style={styles.label}>{label}</Text></Card>)}
    </View>
    <Card>
      <Text style={styles.section}>Published by platform</Text>
      {(data?.byPlatform||[]).map((row:any)=><View key={row.platform} style={styles.row}><Text style={styles.platform}>{row.platform}</Text><Text style={styles.count}>{row.posts}</Text></View>)}
    </Card>
  </PageScroll>;
}
const styles=StyleSheet.create({
  grid:{flexDirection:"row",flexWrap:"wrap",gap:spacing.md},
  metricCard:{flexGrow:1,flexBasis:180,maxWidth:"100%"},
  value:{color:colors.text,fontSize:30,fontWeight:"900"},
  label:{color:colors.muted,fontWeight:"700"},
  section:{color:colors.text,fontSize:18,fontWeight:"900"},
  row:{flexDirection:"row",justifyContent:"space-between",paddingVertical:8,borderBottomColor:colors.border,borderBottomWidth:1},
  platform:{color:colors.textSoft,fontWeight:"800",textTransform:"capitalize"},
  count:{color:colors.primary,fontWeight:"900"}
});
