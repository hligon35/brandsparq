import { Link } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { api } from "@/api/client";
import { Button, Card, PageHeader, PageScroll, StatusBadge } from "@/components/ui";
import { useResponsive } from "@/hooks/useResponsive";
import { colors, radius, spacing } from "@/theme/tokens";
import type { MarketingPost } from "@/types/domain";

export default function ReviewScreen() {
  const [posts,setPosts]=useState<MarketingPost[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [query,setQuery]=useState("");
  const [selected,setSelected]=useState<string[]>([]);
  const [working,setWorking]=useState(false);
  const {compact}=useResponsive();

  async function load(){
    setLoading(true);setError("");
    try{setPosts(await api.getReviewQueue());}
    catch(err){setPosts([]);setError(err instanceof Error?err.message:"Unable to load review queue.");}
    finally{setLoading(false);}
  }

  useEffect(()=>{void load();},[]);

  const filtered=useMemo(()=>{
    const needle=query.trim().toLowerCase();
    if(!needle)return posts;
    return posts.filter(post=>
      [post.clientName,post.platform,post.title,post.caption]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  },[posts,query]);

  function toggle(id:string){
    setSelected(current=>current.includes(id)?current.filter(item=>item!==id):[...current,id]);
  }

  async function bulkApprove(){
    if(!selected.length)return;
    setWorking(true);
    try{
      const result=await api.bulkApprovePosts(selected);
      const failed=result.results.filter((item:any)=>!item.ok);
      setSelected([]);
      await load();
      if(failed.length)Alert.alert("Bulk approval finished",`${failed.length} post(s) need attention.`);
    }catch(err){
      Alert.alert("Bulk approval failed",err instanceof Error?err.message:"Try again.");
    }finally{setWorking(false);}
  }

  async function bulkReject(){
    if(!selected.length)return;
    setWorking(true);
    try{
      await api.bulkRejectPosts(selected,"Changes requested during bulk review.");
      setSelected([]);
      await load();
    }catch(err){
      Alert.alert("Unable to request changes",err instanceof Error?err.message:"Try again.");
    }finally{setWorking(false);}
  }

  return(
    <PageScroll>
      <PageHeader
        eyebrow="Approval inbox"
        title="Review"
        subtitle="Search, select, approve, or request changes before anything enters the marketing calendar."
        action={<Pressable onPress={load}><Text style={styles.refresh}>Refresh</Text></Pressable>}
      />

      <Card subtle>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search client, platform, headline, or caption"
          placeholderTextColor={colors.muted}
          style={styles.search}
        />
        {!!selected.length&&(
          <View style={styles.bulkBar}>
            <Text style={styles.selectedText}>{selected.length} selected</Text>
            <View style={styles.bulkActions}>
              <Button label={working?"Working…":"Approve selected"} small onPress={working?undefined:bulkApprove}/>
              <Button label="Request changes" small secondary onPress={working?undefined:bulkReject}/>
              <Button label="Clear" small secondary onPress={()=>setSelected([])}/>
            </View>
          </View>
        )}
      </Card>

      {loading?(
        <View style={styles.loading}><ActivityIndicator color={colors.primary}/></View>
      ):error?(
        <Card subtle>
          <Text style={styles.emptyTitle}>Review queue unavailable</Text>
          <Text style={styles.emptyBody}>{error}</Text>
          <Pressable onPress={load}><Text style={styles.refresh}>Try again</Text></Pressable>
        </Card>
      ):filtered.length?(
        <View style={styles.grid}>
          {filtered.map(post=>{
            const active=selected.includes(post.id);
            return(
              <View key={post.id} style={[styles.gridItem,compact&&styles.gridItemCompact]}>
                <Card style={[styles.card,active&&styles.cardSelected]}>
                  <View style={styles.cardTop}>
                    <Pressable onPress={()=>toggle(post.id)} style={[styles.selector,active&&styles.selectorActive]}>
                      <Text style={[styles.selectorText,active&&styles.selectorTextActive]}>{active?"✓":"Select"}</Text>
                    </Pressable>
                    <StatusBadge label={post.status}/>
                    {!!post.sparqScore&&<Text style={styles.score}>{post.sparqScore}</Text>}
                  </View>
                  <Text style={styles.client}>{post.clientName||"Client"}</Text>
                  <Text style={styles.platform}>{post.platform.toUpperCase()}</Text>
                  <Text style={styles.cardTitle}>{post.title}</Text>
                  {!!post.suggestedPublishAt&&(
                    <Text style={styles.time}>Suggested · {new Date(post.suggestedPublishAt).toLocaleString()}</Text>
                  )}
                  <Link href={`/posts/${post.id}`} asChild>
                    <Pressable style={styles.openButton}><Text style={styles.openText}>Open review →</Text></Pressable>
                  </Link>
                </Card>
              </View>
            );
          })}
        </View>
      ):(
        <Card subtle>
          <Text style={styles.emptyTitle}>{query?"No matching review items":"You’re caught up."}</Text>
          <Text style={styles.emptyBody}>{query?"Try a different search.":"Nothing is waiting for approval right now."}</Text>
        </Card>
      )}
    </PageScroll>
  );
}

const styles=StyleSheet.create({
  refresh:{color:colors.primary,fontWeight:"800",paddingVertical:8},
  loading:{paddingVertical:60},
  search:{minHeight:48,color:colors.text,backgroundColor:colors.surface,borderRadius:radius.md,borderWidth:1,borderColor:colors.border,paddingHorizontal:spacing.md},
  bulkBar:{marginTop:spacing.sm,flexDirection:"row",flexWrap:"wrap",alignItems:"center",justifyContent:"space-between",gap:spacing.sm},
  selectedText:{color:colors.text,fontWeight:"900"},bulkActions:{flexDirection:"row",flexWrap:"wrap",gap:8},
  grid:{flexDirection:"row",flexWrap:"wrap",gap:spacing.md,alignItems:"stretch"},
  gridItem:{flexGrow:1,flexBasis:310,maxWidth:"100%"},gridItemCompact:{flexBasis:"100%"},
  card:{height:"100%",minHeight:245},cardSelected:{borderColor:colors.primary,borderWidth:2},
  cardTop:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",gap:spacing.sm,flexWrap:"wrap"},
  selector:{paddingHorizontal:10,paddingVertical:7,borderRadius:radius.pill,backgroundColor:colors.surface2,borderWidth:1,borderColor:colors.border},
  selectorActive:{backgroundColor:colors.primary,borderColor:colors.primary},
  selectorText:{color:colors.textSoft,fontWeight:"800",fontSize:11},selectorTextActive:{color:colors.white},
  score:{color:colors.orange,fontSize:22,fontWeight:"900"},client:{color:colors.text,fontSize:18,fontWeight:"900"},
  platform:{color:colors.primary,fontSize:11,fontWeight:"900",letterSpacing:1.1},
  cardTitle:{color:colors.textSoft,fontSize:16,lineHeight:23,fontWeight:"700"},
  time:{color:colors.muted,fontSize:13,lineHeight:19,marginTop:"auto"},
  openButton:{marginTop:spacing.sm},openText:{color:colors.primary,fontWeight:"800"},
  emptyTitle:{color:colors.text,fontSize:20,fontWeight:"900"},emptyBody:{color:colors.muted},
});
