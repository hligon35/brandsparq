import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput } from "react-native";
import { api } from "@/api/client";
import { Button, Card, Screen } from "@/components/ui";
import { colors, radius, spacing } from "@/theme/tokens";

const fields = [
  ["voice","Brand voice"],
  ["audience","Audience"],
  ["tagline","Tagline"],
  ["website","Website"],
  ["preferredCtas","Preferred CTAs"],
  ["imageryPreferences","Imagery preferences"],
  ["postingRules","Posting rules"],
  ["restrictedWords","Restricted words / claims"]
] as const;

export default function BrandBrainScreen() {
  const { clientId } = useLocalSearchParams<{clientId:string}>();
  const [brand,setBrand] = useState<Record<string,string>>({});
  const [name,setName] = useState("Brand Brain");
  const [saving,setSaving] = useState(false);

  useEffect(() => {
    if (!clientId) return;
    api.getBrand(clientId).then(({data}) => {
      setName(data.name || "Brand Brain");
      setBrand({
        voice:data.voice || "",
        audience:data.audience || "",
        tagline:data.tagline || "",
        website:data.website || "",
        preferredCtas:data.preferred_ctas || "",
        imageryPreferences:data.imagery_preferences || "",
        postingRules:data.posting_rules || "",
        restrictedWords:data.restricted_words || "",
        primaryColor:data.primary_color || "",
        secondaryColor:data.secondary_color || ""
      });
    }).catch(() => {});
  },[clientId]);

  async function save(){
    if(!clientId) return;
    setSaving(true);
    try{
      await api.saveBrand(clientId, brand);
      Alert.alert("Brand Brain saved","Future generations will use these rules.");
    }catch(error){
      Alert.alert("Unable to save",error instanceof Error?error.message:"Try again.");
    }finally{setSaving(false);}
  }

  return <Screen>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>{name}</Text>
      <Text style={styles.sub}>These rules shape copy, creative direction, CTAs and scheduling recommendations.</Text>
      <Card>
        <Text style={styles.label}>Brand colors</Text>
        <TextInput style={styles.input} value={brand.primaryColor||""} onChangeText={(v)=>setBrand({...brand,primaryColor:v})} placeholder="#A56CFF" placeholderTextColor={colors.muted}/>
        <TextInput style={styles.input} value={brand.secondaryColor||""} onChangeText={(v)=>setBrand({...brand,secondaryColor:v})} placeholder="#11131A" placeholderTextColor={colors.muted}/>
      </Card>
      {fields.map(([key,label]) => <Card key={key}>
        <Text style={styles.label}>{label}</Text>
        <TextInput
          style={[styles.input,["voice","audience","imageryPreferences","postingRules"].includes(key)&&styles.multiline]}
          value={brand[key]||""}
          onChangeText={(v)=>setBrand({...brand,[key]:v})}
          placeholder={label}
          placeholderTextColor={colors.muted}
          multiline={["voice","audience","imageryPreferences","postingRules"].includes(key)}
        />
      </Card>)}
      <Button label={saving?"Saving…":"Save Brand Brain"} onPress={saving?undefined:save}/>
    </ScrollView>
  </Screen>;
}
const styles=StyleSheet.create({
  content:{gap:spacing.md,paddingBottom:40},
  title:{color:colors.text,fontSize:28,fontWeight:"800"},
  sub:{color:colors.muted,fontSize:15,lineHeight:22},
  label:{color:colors.muted,fontSize:12,fontWeight:"800",textTransform:"uppercase"},
  input:{minHeight:48,color:colors.text,backgroundColor:colors.surface2,borderRadius:radius.md,borderWidth:1,borderColor:colors.border,paddingHorizontal:spacing.md,paddingVertical:12,fontSize:16},
  multiline:{minHeight:100,textAlignVertical:"top"}
});
