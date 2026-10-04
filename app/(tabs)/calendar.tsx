import { Link } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { api } from "@/api/client";
import { Button, Card, PageHeader, PageScroll, StatusBadge } from "@/components/ui";
import { useResponsive } from "@/hooks/useResponsive";
import { colors, radius, spacing } from "@/theme/tokens";
import type { Client, MarketingPost, Platform } from "@/types/domain";

type CalendarMode="day"|"week"|"month";

function startOfDay(value:Date){
  const d=new Date(value);d.setHours(0,0,0,0);return d;
}
function startOfWeek(value:Date){
  const d=startOfDay(value);d.setDate(d.getDate()-d.getDay());return d;
}
function startOfMonth(value:Date){
  const d=startOfDay(value);d.setDate(1);return d;
}
function addDays(value:Date,days:number){
  const d=new Date(value);d.setDate(d.getDate()+days);return d;
}
function sameDay(value:string|undefined,date:Date){
  if(!value)return false;
  const d=new Date(value);
  return d.getFullYear()===date.getFullYear()&&d.getMonth()===date.getMonth()&&d.getDate()===date.getDate();
}
function rangeFor(mode:CalendarMode,anchor:Date){
  if(mode==="day"){
    const from=startOfDay(anchor);return{from,to:addDays(from,1),days:[from]};
  }
  if(mode==="week"){
    const from=startOfWeek(anchor);
    return{from,to:addDays(from,7),days:Array.from({length:7},(_,i)=>addDays(from,i))};
  }
  const month=startOfMonth(anchor);
  const gridStart=startOfWeek(month);
  const days=Array.from({length:42},(_,i)=>addDays(gridStart,i));
  return{from:gridStart,to:addDays(gridStart,42),days};
}
function titleFor(mode:CalendarMode,anchor:Date){
  if(mode==="day")return anchor.toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric",year:"numeric"});
  if(mode==="week"){
    const start=startOfWeek(anchor),end=addDays(start,6);
    return `${start.toLocaleDateString(undefined,{month:"short",day:"numeric"})} – ${end.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})}`;
  }
  return anchor.toLocaleDateString(undefined,{month:"long",year:"numeric"});
}

export default function CalendarScreen(){
  const [mode,setMode]=useState<CalendarMode>("week");
  const [anchor,setAnchor]=useState(startOfDay(new Date()));
  const [posts,setPosts]=useState<MarketingPost[]>([]);
  const [clients,setClients]=useState<Client[]>([]);
  const [clientFilter,setClientFilter]=useState("all");
  const [platformFilter,setPlatformFilter]=useState<"all"|Platform>("all");
  const [query,setQuery]=useState("");
  const [selected,setSelected]=useState<string[]>([]);
  const [error,setError]=useState("");
  const [working,setWorking]=useState(false);
  const {compact}=useResponsive();

  const range=useMemo(()=>rangeFor(mode,anchor),[mode,anchor]);

  async function load(){
    setError("");
    try{
      const [calendar,clientRows]=await Promise.all([
        api.getCalendar(range.from.toISOString(),range.to.toISOString()),
        api.getClients(),
      ]);
      setPosts(calendar);setClients(clientRows);
    }catch(err){
      setPosts([]);setError(err instanceof Error?err.message:"Unable to load calendar.");
    }
  }

  useEffect(()=>{void load();},[mode,anchor]);

  const filtered=useMemo(()=>{
    const needle=query.trim().toLowerCase();
    return posts.filter(post=>{
      if(clientFilter!=="all"&&post.clientId!==clientFilter)return false;
      if(platformFilter!=="all"&&post.platform!==platformFilter)return false;
      if(needle&&![
        post.clientName,post.platform,post.title,post.caption,post.socialAccountName,post.status
      ].filter(Boolean).join(" ").toLowerCase().includes(needle))return false;
      return true;
    });
  },[posts,clientFilter,platformFilter,query]);

  function navigate(direction:number){
    const next=new Date(anchor);
    if(mode==="day")next.setDate(next.getDate()+direction);
    if(mode==="week")next.setDate(next.getDate()+7*direction);
    if(mode==="month")next.setMonth(next.getMonth()+direction,1);
    setAnchor(startOfDay(next));setSelected([]);
  }

  function toggle(id:string){
    setSelected(current=>current.includes(id)?current.filter(item=>item!==id):[...current,id]);
  }

  async function shift(minutes:number){
    if(!selected.length)return;
    setWorking(true);
    try{
      const result=await api.bulkShiftPosts(selected,minutes);
      const failures=result.results.filter((item:any)=>!item.ok);
      setSelected([]);await load();
      if(failures.length)Alert.alert("Calendar updated",`${failures.length} post(s) could not be shifted.`);
    }catch(err){
      Alert.alert("Unable to shift posts",err instanceof Error?err.message:"Try again.");
    }finally{setWorking(false);}
  }

  async function pause(){
    if(!selected.length)return;
    setWorking(true);
    try{
      await api.bulkPausePosts(selected);
      setSelected([]);await load();
    }catch(err){
      Alert.alert("Unable to pause posts",err instanceof Error?err.message:"Try again.");
    }finally{setWorking(false);}
  }

  function postCard(post:MarketingPost){
    const active=selected.includes(post.id);
    return(
      <Card key={post.id} style={[styles.postCard,active&&styles.postCardSelected]}>
        <View style={styles.row}>
          <Pressable onPress={()=>toggle(post.id)} style={[styles.selector,active&&styles.selectorActive]}>
            <Text style={[styles.selectorText,active&&styles.selectorTextActive]}>{active?"✓":"Select"}</Text>
          </Pressable>
          <StatusBadge label={post.status}/>
          <Text style={styles.platform}>{post.platform.toUpperCase()}</Text>
        </View>
        <Text style={styles.cardTitle}>{post.clientName||"Client"}</Text>
        <Text style={styles.sub} numberOfLines={2}>{post.title}</Text>
        <Text style={styles.destination}>{post.socialAccountName||"Publishing account not assigned"}</Text>
        <View style={styles.cardBottom}>
          <Text style={styles.time}>
            {post.scheduledPublishAt?new Date(post.scheduledPublishAt).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"}):""}
          </Text>
          <Link href={`/posts/${post.id}/publish`} asChild>
            <Pressable style={styles.openLink}><Text style={styles.openText}>Open →</Text></Pressable>
          </Link>
        </View>
      </Card>
    );
  }

  const platforms:Array<"all"|Platform>=["all","instagram","facebook","linkedin","tiktok","x"];

  return(
    <PageScroll>
      <PageHeader
        eyebrow="Approved strategy"
        title="Calendar"
        subtitle="Navigate true day, week, and month views. Search, filter, select, shift, pause, or open approved posts."
      />

      <View style={styles.toolbar}>
        <View style={styles.modeRow}>
          {(["day","week","month"] as CalendarMode[]).map(item=>(
            <Pressable key={item} onPress={()=>{setMode(item);setSelected([]);}} style={[styles.modeButton,mode===item&&styles.modeButtonActive]}>
              <Text style={[styles.modeText,mode===item&&styles.modeTextActive]}>{item}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.navRow}>
          <Button label="‹" secondary small onPress={()=>navigate(-1)}/>
          <Button label="Today" secondary small onPress={()=>setAnchor(startOfDay(new Date()))}/>
          <Button label="›" secondary small onPress={()=>navigate(1)}/>
        </View>
      </View>

      <Text style={styles.rangeTitle}>{titleFor(mode,anchor)}</Text>

      <Card subtle>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search client, platform, headline, status, or account"
          placeholderTextColor={colors.muted}
          style={styles.search}
        />

        <Text style={styles.filterLabel}>Client</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.chips}>
            <Pressable onPress={()=>setClientFilter("all")} style={[styles.chip,clientFilter==="all"&&styles.chipActive]}>
              <Text style={[styles.chipText,clientFilter==="all"&&styles.chipTextActive]}>All clients</Text>
            </Pressable>
            {clients.map(client=>(
              <Pressable key={client.id} onPress={()=>setClientFilter(client.id)} style={[styles.chip,clientFilter===client.id&&styles.chipActive]}>
                <Text style={[styles.chipText,clientFilter===client.id&&styles.chipTextActive]}>{client.name}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        <Text style={styles.filterLabel}>Platform</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.chips}>
            {platforms.map(platform=>(
              <Pressable key={platform} onPress={()=>setPlatformFilter(platform)} style={[styles.chip,platformFilter===platform&&styles.chipActive]}>
                <Text style={[styles.chipText,platformFilter===platform&&styles.chipTextActive]}>
                  {platform==="all"?"All platforms":platform}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        {!!selected.length&&(
          <View style={styles.bulkBar}>
            <Text style={styles.selectedText}>{selected.length} selected</Text>
            <View style={styles.bulkActions}>
              <Button label="−1 day" small secondary onPress={working?undefined:()=>shift(-1440)}/>
              <Button label="+1 day" small secondary onPress={working?undefined:()=>shift(1440)}/>
              <Button label="Pause" small secondary onPress={working?undefined:pause}/>
              <Button label="Clear" small secondary onPress={()=>setSelected([])}/>
            </View>
          </View>
        )}
      </Card>

      {error&&(
        <Card subtle>
          <Text style={styles.emptyTitle}>Calendar unavailable</Text>
          <Text style={styles.sub}>{error}</Text>
          <Pressable onPress={load}><Text style={styles.openText}>Try again</Text></Pressable>
        </Card>
      )}

      {!error&&mode==="day"&&(
        <View style={styles.dayView}>
          {filtered
            .filter(post=>sameDay(post.scheduledPublishAt,anchor))
            .sort((a,b)=>Date.parse(a.scheduledPublishAt||"")-Date.parse(b.scheduledPublishAt||""))
            .map(postCard)}
          {!filtered.some(post=>sameDay(post.scheduledPublishAt,anchor))&&(
            <Card subtle><Text style={styles.emptyTitle}>Open space</Text><Text style={styles.sub}>No posts scheduled for this day.</Text></Card>
          )}
        </View>
      )}

      {!error&&mode==="week"&&(
        <ScrollView horizontal={compact} showsHorizontalScrollIndicator={false}>
          <View style={[styles.weekGrid,compact&&styles.weekGridCompact]}>
            {range.days.map(day=>{
              const dayPosts=filtered.filter(post=>sameDay(post.scheduledPublishAt,day));
              return(
                <View key={day.toISOString()} style={styles.weekColumn}>
                  <Pressable onPress={()=>{setAnchor(day);setMode("day");}}>
                    <Text style={styles.weekDay}>{day.toLocaleDateString(undefined,{weekday:"short"})}</Text>
                    <Text style={styles.weekDate}>{day.getDate()}</Text>
                  </Pressable>
                  <View style={styles.weekPosts}>
                    {dayPosts.map(postCard)}
                    {!dayPosts.length&&<Text style={styles.openSpace}>Open</Text>}
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}

      {!error&&mode==="month"&&(
        <View>
          <View style={styles.weekdayHeader}>
            {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(day=><Text key={day} style={styles.weekdayLabel}>{day}</Text>)}
          </View>
          <View style={styles.monthGrid}>
            {range.days.map(day=>{
              const inMonth=day.getMonth()===anchor.getMonth();
              const dayPosts=filtered.filter(post=>sameDay(post.scheduledPublishAt,day));
              return(
                <Pressable
                  key={day.toISOString()}
                  onPress={()=>{setAnchor(day);setMode("day");}}
                  style={[styles.monthCell,!inMonth&&styles.monthCellMuted]}
                >
                  <View style={styles.monthCellTop}>
                    <Text style={[styles.monthDate,!inMonth&&styles.mutedText]}>{day.getDate()}</Text>
                    {!!dayPosts.length&&<Text style={styles.monthCount}>{dayPosts.length}</Text>}
                  </View>
                  {dayPosts.slice(0,2).map(post=>(
                    <View key={post.id} style={styles.monthPost}>
                      <Text numberOfLines={1} style={styles.monthPostText}>{post.clientName} · {post.platform}</Text>
                    </View>
                  ))}
                  {dayPosts.length>2&&<Text style={styles.moreText}>+{dayPosts.length-2} more</Text>}
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
    </PageScroll>
  );
}

const styles=StyleSheet.create({
  toolbar:{flexDirection:"row",flexWrap:"wrap",justifyContent:"space-between",alignItems:"center",gap:spacing.sm},
  modeRow:{flexDirection:"row",gap:8},navRow:{flexDirection:"row",gap:8},
  modeButton:{paddingHorizontal:16,paddingVertical:10,borderRadius:radius.pill,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border},
  modeButtonActive:{backgroundColor:colors.primary,borderColor:colors.primary},
  modeText:{color:colors.textSoft,fontWeight:"800",textTransform:"capitalize"},modeTextActive:{color:colors.white},
  rangeTitle:{color:colors.text,fontSize:22,fontWeight:"900"},
  search:{minHeight:48,color:colors.text,backgroundColor:colors.surface,borderRadius:radius.md,borderWidth:1,borderColor:colors.border,paddingHorizontal:spacing.md},
  filterLabel:{color:colors.muted,fontSize:11,fontWeight:"900",textTransform:"uppercase",letterSpacing:.8},
  chips:{flexDirection:"row",gap:8,paddingVertical:5},
  chip:{paddingHorizontal:13,paddingVertical:8,borderRadius:radius.pill,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border},
  chipActive:{backgroundColor:colors.primary,borderColor:colors.primary},
  chipText:{color:colors.textSoft,fontWeight:"700",textTransform:"capitalize"},chipTextActive:{color:colors.white},
  bulkBar:{marginTop:spacing.sm,flexDirection:"row",flexWrap:"wrap",justifyContent:"space-between",alignItems:"center",gap:spacing.sm},
  selectedText:{color:colors.text,fontWeight:"900"},bulkActions:{flexDirection:"row",flexWrap:"wrap",gap:8},
  dayView:{gap:spacing.md},
  postCard:{minHeight:190,minWidth:0},postCardSelected:{borderWidth:2,borderColor:colors.primary},
  row:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:6,flexWrap:"wrap"},
  selector:{paddingHorizontal:8,paddingVertical:6,borderRadius:radius.pill,backgroundColor:colors.surface2},
  selectorActive:{backgroundColor:colors.primary},selectorText:{color:colors.textSoft,fontSize:10,fontWeight:"800"},selectorTextActive:{color:colors.white},
  platform:{color:colors.primary,fontWeight:"900",fontSize:10,letterSpacing:.8},
  cardTitle:{color:colors.text,fontSize:17,fontWeight:"900"},sub:{color:colors.muted,fontSize:14,lineHeight:20},
  destination:{color:colors.textSoft,fontSize:11,fontWeight:"700"},
  cardBottom:{marginTop:"auto",flexDirection:"row",justifyContent:"space-between",alignItems:"center",gap:8},
  time:{color:colors.primaryDark,fontWeight:"900"},openLink:{paddingVertical:6},openText:{color:colors.primary,fontWeight:"800"},
  weekGrid:{flexDirection:"row",gap:8,width:"100%"},weekGridCompact:{minWidth:1540},
  weekColumn:{flex:1,minWidth:0,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,borderRadius:radius.md,padding:8},
  weekDay:{color:colors.muted,fontSize:11,fontWeight:"800",textTransform:"uppercase"},
  weekDate:{color:colors.text,fontSize:20,fontWeight:"900"},weekPosts:{gap:8,marginTop:8},openSpace:{color:colors.muted,fontStyle:"italic"},
  weekdayHeader:{flexDirection:"row"},weekdayLabel:{width:"14.285%",textAlign:"center",color:colors.muted,fontSize:11,fontWeight:"900",paddingVertical:8},
  monthGrid:{flexDirection:"row",flexWrap:"wrap",borderTopWidth:1,borderLeftWidth:1,borderColor:colors.border},
  monthCell:{width:"14.285%",minHeight:128,padding:7,borderRightWidth:1,borderBottomWidth:1,borderColor:colors.border,backgroundColor:colors.surface},
  monthCellMuted:{backgroundColor:colors.surface2},monthCellTop:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},
  monthDate:{color:colors.text,fontWeight:"900"},mutedText:{color:colors.muted},monthCount:{color:colors.primary,fontSize:11,fontWeight:"900"},
  monthPost:{marginTop:6,paddingHorizontal:5,paddingVertical:4,borderRadius:6,backgroundColor:"#EAF3FF"},
  monthPostText:{color:colors.primaryDark,fontSize:9,fontWeight:"800"},moreText:{color:colors.muted,fontSize:9,marginTop:4},
  emptyTitle:{color:colors.text,fontSize:20,fontWeight:"900"},
});
