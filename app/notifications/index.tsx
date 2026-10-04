import { useEffect, useMemo, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "@/api/client";
import { registerThisDeviceForPush } from "@/notifications/register";
import { Button, Card, PageHeader, PageScroll, StatusBadge } from "@/components/ui";
import { colors, radius, spacing } from "@/theme/tokens";

type Filter="all"|"unread"|"failed";

export default function NotificationsScreen(){
  const [items,setItems]=useState<any[]>([]);
  const [unread,setUnread]=useState(0);
  const [filter,setFilter]=useState<Filter>("all");
  const [loading,setLoading]=useState(false);

  async function load(){
    setLoading(true);
    try{
      const result=await api.getNotifications();
      setItems(result.data);setUnread(result.unreadCount||0);
    }finally{setLoading(false);}
  }
  useEffect(()=>{void load();},[]);

  const visible=useMemo(()=>items.filter(item=>{
    if(filter==="unread")return !item.read_at;
    if(filter==="failed")return ["failed","partial"].includes(item.status);
    return true;
  }),[items,filter]);

  async function test(){
    try{
      await api.testNotifications();
      Alert.alert("Test sent","BrandSparQ sent a test through your enabled notification channels.");
      await load();
    }catch(e){Alert.alert("Unable to test",e instanceof Error?e.message:"Try again.");}
  }

  async function enablePush(){
    try{
      await registerThisDeviceForPush();
      Alert.alert("Push enabled","This device is registered for BrandSparQ alerts.");
      await load();
    }catch(e){Alert.alert("Unable to enable push",e instanceof Error?e.message:"Try again.");}
  }

  async function markRead(item:any){
    if(!item.read_at){
      await api.markNotificationRead(item.id);
      await load();
    }
    if(item.deep_link){
      try{await Linking.openURL(item.deep_link);}catch{}
    }
  }

  async function markAll(){
    await api.markAllNotificationsRead();
    await load();
  }

  return <PageScroll>
    <PageHeader
      eyebrow="Alerts"
      title="Notifications"
      subtitle={unread?`${unread} unread · Review delivery, pre-publish decisions, confirmations, and failures.`:"Review delivery, pre-publish decisions, confirmations, and failures."}
      action={<View style={styles.actions}>
        <Button label="Enable push" small secondary onPress={enablePush}/>
        <Button label="Send test" small secondary onPress={test}/>
      </View>}
    />

    <View style={styles.toolbar}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.filters}>
          {(["all","unread","failed"] as Filter[]).map(value=>
            <Pressable key={value} onPress={()=>setFilter(value)} style={[styles.filter,filter===value&&styles.filterActive]}>
              <Text style={[styles.filterText,filter===value&&styles.filterTextActive]}>
                {value==="all"?"All":value==="unread"?`Unread (${unread})`:"Delivery issues"}
              </Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
      {!!unread&&<Button label="Mark all read" small secondary onPress={markAll}/>}
    </View>

    <View style={styles.list}>
      {visible.map(item=>{
        const deliveries=item.deliveries||[];
        return <Card key={item.id} style={!item.read_at?styles.unreadCard:undefined}>
          <View style={styles.row}>
            <View style={styles.statusRow}>
              {!item.read_at&&<View style={styles.dot}/>}
              <StatusBadge label={item.status}/>
            </View>
            <Text style={styles.time}>{new Date(item.created_at).toLocaleString()}</Text>
          </View>
          <Text style={styles.title}>{item.title||item.type}</Text>
          {!!item.body&&<Text style={styles.body}>{item.body}</Text>}

          {!!deliveries.length&&<View style={styles.deliveryRow}>
            {deliveries.map((delivery:any,index:number)=>
              <View key={`${delivery.channel}-${index}`} style={styles.delivery}>
                <Text style={styles.deliveryChannel}>{delivery.channel.replace("_"," ")}</Text>
                <Text style={[styles.deliveryStatus,delivery.status==="failed"&&styles.failed]}>
                  {delivery.status}
                </Text>
              </View>
            )}
          </View>}

          {!!item.error_message&&<Text style={styles.error}>{item.error_message}</Text>}
          <View style={styles.cardActions}>
            {!item.read_at&&<Pressable onPress={()=>markRead({...item,deep_link:null})}><Text style={styles.link}>Mark read</Text></Pressable>}
            {!!item.deep_link&&<Pressable onPress={()=>markRead(item)}><Text style={styles.link}>Open →</Text></Pressable>}
          </View>
        </Card>;
      })}
      {!visible.length&&<Card subtle><Text style={styles.body}>{loading?"Loading notifications…":"No notifications match this view."}</Text></Card>}
    </View>
  </PageScroll>;
}

const styles=StyleSheet.create({
  actions:{flexDirection:"row",flexWrap:"wrap",gap:8},
  toolbar:{flexDirection:"row",flexWrap:"wrap",alignItems:"center",justifyContent:"space-between",gap:spacing.sm},
  filters:{flexDirection:"row",gap:8},
  filter:{paddingHorizontal:13,paddingVertical:8,borderRadius:radius.pill,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border},
  filterActive:{backgroundColor:colors.primary,borderColor:colors.primary},
  filterText:{color:colors.textSoft,fontWeight:"800"},filterTextActive:{color:colors.white},
  list:{gap:spacing.md},unreadCard:{borderColor:colors.primary,borderWidth:2},
  row:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:spacing.sm},
  statusRow:{flexDirection:"row",alignItems:"center",gap:8},dot:{width:8,height:8,borderRadius:4,backgroundColor:colors.primary},
  time:{color:colors.muted,fontSize:12},title:{color:colors.text,fontSize:17,fontWeight:"900"},
  body:{color:colors.muted,lineHeight:21},
  deliveryRow:{flexDirection:"row",flexWrap:"wrap",gap:8},
  delivery:{flexDirection:"row",gap:6,alignItems:"center",paddingHorizontal:9,paddingVertical:6,borderRadius:radius.pill,backgroundColor:colors.surface2},
  deliveryChannel:{color:colors.textSoft,fontSize:11,fontWeight:"800",textTransform:"capitalize"},
  deliveryStatus:{color:colors.success,fontSize:11,fontWeight:"900",textTransform:"capitalize"},
  failed:{color:colors.danger},error:{color:colors.danger,fontSize:12,lineHeight:18},
  cardActions:{flexDirection:"row",justifyContent:"flex-end",gap:spacing.md},link:{color:colors.primary,fontWeight:"900"},
});
