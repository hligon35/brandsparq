import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "@/api/client";
import { Button, Card, PageHeader, PageScroll, StatusBadge } from "@/components/ui";
import { colors, spacing } from "@/theme/tokens";

const platforms=["instagram","facebook","linkedin","tiktok","x"];

export default function SocialConnectionsScreen(){
  const [clients,setClients]=useState<any[]>([]);
  const [clientId,setClientId]=useState("");
  const [accounts,setAccounts]=useState<any[]>([]);
  async function load(){
    const c=await api.getClients();
    setClients(c);
    const selected=clientId || c[0]?.id || "";
    if(!clientId && selected) setClientId(selected);
    if(selected) setAccounts((await api.getSocialAccounts(selected)).data);
  }
  useEffect(()=>{void load();},[]);
  useEffect(()=>{ if(clientId) api.getSocialAccounts(clientId).then(r=>setAccounts(r.data)).catch(()=>{}); },[clientId]);

  async function connect(platformName:string){
    if(!clientId) return;
    const returnTo = Platform.OS==="web" ? `${window.location.origin}/social` : Linking.createURL("/social");
    const url=api.getSocialConnectUrl(platformName,clientId,returnTo);
    if(Platform.OS==="web"){ window.location.assign(url); return; }
    await WebBrowser.openBrowserAsync(url);
  }

  async function disconnect(id:string){
    await api.disconnectSocialAccount(id);
    await load();
  }

  return <PageScroll>
    <PageHeader eyebrow="Publishing destinations" title="Social connections" subtitle="Connect each client's social accounts. Credentials are stored encrypted in the Worker." />
    <Card>
      <Text style={styles.label}>Client</Text>
      <View style={styles.chips}>
        {clients.map(client=><Pressable key={client.id} onPress={()=>setClientId(client.id)} style={[styles.chip,client.id===clientId&&styles.chipActive]}><Text style={[styles.chipText,client.id===clientId&&styles.chipTextActive]}>{client.name}</Text></Pressable>)}
      </View>
    </Card>
    <View style={styles.grid}>
      {platforms.map(platformName=>{
        const existing=accounts.filter(a=>a.platform===platformName);
        return <Card key={platformName} style={styles.card}>
          <View style={styles.row}><Text style={styles.title}>{platformName==="x"?"X":platformName[0].toUpperCase()+platformName.slice(1)}</Text><StatusBadge label={existing.length?"connected":"disconnected"}/></View>
          {existing.map(account=><View key={account.id} style={styles.account}><Text style={styles.accountName}>{account.account_name}</Text><Text style={styles.meta}>{account.account_type || account.external_account_id}</Text><Button label="Disconnect" secondary small onPress={()=>disconnect(account.id)}/></View>)}
          {!existing.length && <Text style={styles.meta}>No account connected.</Text>}
          <Button label={existing.length?"Connect another":"Connect"} onPress={()=>connect(platformName)}/>
        </Card>;
      })}
    </View>
  </PageScroll>;
}
const styles=StyleSheet.create({
  label:{color:colors.muted,fontSize:12,fontWeight:"800",textTransform:"uppercase"},
  chips:{flexDirection:"row",flexWrap:"wrap",gap:8},
  chip:{paddingHorizontal:14,paddingVertical:9,borderRadius:999,backgroundColor:colors.surface2},
  chipActive:{backgroundColor:colors.primary},
  chipText:{color:colors.textSoft,fontWeight:"700"},
  chipTextActive:{color:colors.white},
  grid:{flexDirection:"row",flexWrap:"wrap",gap:spacing.md},
  card:{flexGrow:1,flexBasis:300,maxWidth:"100%",minHeight:210},
  row:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:spacing.sm},
  title:{color:colors.text,fontSize:19,fontWeight:"900"},
  account:{gap:5,paddingVertical:8,borderBottomWidth:1,borderBottomColor:colors.border},
  accountName:{color:colors.text,fontWeight:"800"},
  meta:{color:colors.muted,fontSize:13,lineHeight:19}
});
