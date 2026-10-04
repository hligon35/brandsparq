import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { api } from "@/api/client";
import { Button, Card, PageHeader, PageScroll, SectionTitle, StatusBadge } from "@/components/ui";
import { colors, radius, spacing } from "@/theme/tokens";

function count(rows:any[],status:string){return Number(rows?.find(row=>row.status===status)?.count||0);}

export default function SystemHealthScreen(){
  const [data,setData]=useState<any>();
  const [loading,setLoading]=useState(false);
  const [certification,setCertification]=useState<any>();
  const [certifying,setCertifying]=useState(false);

  async function load(){
    setLoading(true);
    try{setData((await api.getSystemOverview()).data);}
    catch(e){Alert.alert("Unable to load system health",e instanceof Error?e.message:"Try again.");}
    finally{setLoading(false);}
  }
  useEffect(()=>{void load();},[]);

  async function certify(){
    setCertifying(true);
    try{
      const result=await api.runLaunchCertification();
      setCertification(result.data);
      if(result.data.status==="blocked"){
        Alert.alert("Launch blocked",result.data.blockers.join("\n")||"Resolve the failed launch checks.");
      }else{
        Alert.alert(
          result.data.status==="ready"?"Launch checks passed":"Ready with warnings",
          result.data.warnings.join("\n")||"BrandSparQ passed all automated launch checks."
        );
      }
    }catch(e){Alert.alert("Certification failed",e instanceof Error?e.message:"Try again.");}
    finally{setCertifying(false);}
  }

  async function recover(){
    try{
      const result=await api.recoverSystemWork();
      Alert.alert("Recovery complete","Publishing recovered: "+result.data.publishRecovered+"\nGeneration recovered: "+result.data.generationRecovered+"\nGraphics recovered: "+(result.data.graphicsRecovered||0));
      await load();
    }catch(e){Alert.alert("Recovery failed",e instanceof Error?e.message:"Try again.");}
  }

  async function retry(postId:string){
    try{await api.retryFailedPost(postId);await load();}
    catch(e){Alert.alert("Retry failed",e instanceof Error?e.message:"Try again.");}
  }

  async function resolve(id:string){
    try{await api.resolveSystemEvent(id);await load();}
    catch(e){Alert.alert("Unable to resolve",e instanceof Error?e.message:"Try again.");}
  }

  const health=data?.health;
  const checked=health?.timestamp?"Checked "+new Date(health.timestamp).toLocaleString():"Live Worker dependencies";
  return <PageScroll>
    <PageHeader
      eyebrow="Owner operations"
      title="System Health"
      subtitle="Production readiness, queue recovery, active incidents, and failed publishing."
      action={<View style={styles.actions}>
        <Button label={loading?"Refreshing…":"Refresh"} small secondary onPress={loading?undefined:load}/>
        <Button label={certifying?"Checking…":"Run launch check"} small secondary onPress={certifying?undefined:certify}/>
        <Button label="Recover stuck work" small onPress={recover}/>
      </View>}
    />

    <View style={styles.grid}>
      <Card style={styles.metric}>
        <Text style={[styles.big,health?.ok?styles.good:styles.bad]}>{health?.ok?"Healthy":"Needs attention"}</Text>
        <Text style={styles.muted}>Production readiness</Text>
      </Card>
      <Card style={styles.metric}>
        <Text style={styles.big}>{count(data?.publishJobs||[],"failed")}</Text>
        <Text style={styles.muted}>Failed publish jobs · 7 days</Text>
      </Card>
      <Card style={styles.metric}>
        <Text style={styles.big}>{count(data?.generationJobs||[],"failed")}</Text>
        <Text style={styles.muted}>Failed generation jobs · 7 days</Text>
      </Card>
      <Card style={styles.metric}>
        <Text style={styles.big}>{data?.events?.length||0}</Text>
        <Text style={styles.muted}>Active system events</Text>
      </Card>
    </View>

    <Card>
      <SectionTitle title="Launch certification" subtitle="Owner-only automated release checks for schema, production configuration, access integrity, providers, and incidents."/>
      {certification ? <>
        <View style={styles.inline}>
          <StatusBadge label={certification.status}/>
          <Text style={styles.muted}>Checked {new Date(certification.createdAt).toLocaleString()}</Text>
        </View>
        {!!certification.blockers?.length && <View style={styles.certGroup}>
          <Text style={styles.error}>Launch blockers</Text>
          {certification.blockers.map((item:string,index:number)=><Text key={index} style={styles.muted}>• {item}</Text>)}
        </View>}
        {!!certification.warnings?.length && <View style={styles.certGroup}>
          <Text style={styles.warning}>Warnings</Text>
          {certification.warnings.map((item:string,index:number)=><Text key={index} style={styles.muted}>• {item}</Text>)}
        </View>}
        {!certification.blockers?.length&&!certification.warnings?.length&&<Text style={styles.goodText}>All automated launch checks passed.</Text>}
      </> : <Text style={styles.muted}>Run the launch check after applying the latest migrations and production secrets.</Text>}
    </Card>

    <Card>
      <SectionTitle title="Readiness checks" subtitle={checked}/>
      {(health?.checks||[]).map((check:any)=><View key={check.name} style={styles.row}>
        <View style={styles.copy}><Text style={styles.title}>{check.name}</Text><Text style={styles.muted}>{check.detail}</Text></View>
        <StatusBadge label={check.ok?"healthy":"failed"}/>
      </View>)}
    </Card>

    <Card>
      <SectionTitle title="Active incidents" subtitle="Operational warnings and failures that have not been resolved."/>
      {(data?.events||[]).map((event:any)=><View key={event.id} style={styles.incident}>
        <View style={styles.copy}>
          <View style={styles.inline}><StatusBadge label={event.severity}/><Text style={styles.title}>{event.event_type.replaceAll("_"," ")}</Text></View>
          <Text style={styles.muted}>{event.message}</Text>
          <Text style={styles.time}>{new Date(event.created_at).toLocaleString()}</Text>
        </View>
        <Pressable onPress={()=>resolve(event.id)}><Text style={styles.link}>Resolve</Text></Pressable>
      </View>)}
      {!data?.events?.length&&<Text style={styles.muted}>No active incidents.</Text>}
    </Card>

    <Card>
      <SectionTitle title="Failed posts" subtitle="Retry only after the underlying provider/account problem has been corrected."/>
      {(data?.failedPosts||[]).map((post:any)=><View key={post.id} style={styles.incident}>
        <View style={styles.copy}>
          <Text style={styles.title}>{post.title}</Text>
          <Text style={styles.muted}>{post.client_name} · {post.platform} · {post.failure_code||"publish failure"}</Text>
          {!!post.failure_message&&<Text style={styles.error}>{post.failure_message}</Text>}
        </View>
        <Button label="Retry" small secondary onPress={()=>retry(post.id)}/>
      </View>)}
      {!data?.failedPosts?.length&&<Text style={styles.muted}>No failed posts need recovery.</Text>}
    </Card>

    <Card>
      <SectionTitle title="Queue activity" subtitle="Last seven days by job state."/>
      <Text style={styles.group}>Publishing</Text>
      <View style={styles.pills}>{(data?.publishJobs||[]).map((row:any)=><View key={row.status} style={styles.pill}><Text style={styles.pillText}>{row.status}: {row.count}</Text></View>)}</View>
      <Text style={styles.group}>Generation</Text>
      <View style={styles.pills}>{(data?.generationJobs||[]).map((row:any)=><View key={row.status} style={styles.pill}><Text style={styles.pillText}>{row.status}: {row.count}</Text></View>)}</View>
    </Card>
  </PageScroll>;
}

const styles=StyleSheet.create({
  actions:{flexDirection:"row",flexWrap:"wrap",gap:8},grid:{flexDirection:"row",flexWrap:"wrap",gap:spacing.md},
  metric:{flexGrow:1,flexBasis:210},big:{color:colors.text,fontSize:24,fontWeight:"900"},good:{color:colors.success},bad:{color:colors.danger},
  muted:{color:colors.muted,lineHeight:20},row:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:spacing.md,paddingVertical:11,borderBottomWidth:1,borderBottomColor:colors.border},
  incident:{flexDirection:"row",alignItems:"flex-start",justifyContent:"space-between",gap:spacing.md,paddingVertical:12,borderBottomWidth:1,borderBottomColor:colors.border},
  copy:{flex:1,gap:4},title:{color:colors.text,fontWeight:"900",textTransform:"capitalize"},inline:{flexDirection:"row",alignItems:"center",gap:8,flexWrap:"wrap"},
  time:{color:colors.muted,fontSize:11},link:{color:colors.primary,fontWeight:"900"},error:{color:colors.danger,fontSize:12,lineHeight:18},
  group:{color:colors.textSoft,fontWeight:"900",marginTop:spacing.sm},certGroup:{gap:4,marginTop:spacing.sm},warning:{color:colors.warning,fontWeight:"900"},goodText:{color:colors.success,fontWeight:"800"},pills:{flexDirection:"row",flexWrap:"wrap",gap:8},
  pill:{backgroundColor:colors.surface2,borderRadius:radius.pill,paddingHorizontal:11,paddingVertical:7},pillText:{color:colors.textSoft,fontWeight:"800",textTransform:"capitalize"},
});
