import { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { type, space, radius, useTheme } from '../../../theme';
import { SkeletonList } from '../../../components/Skeleton';
import { EmptyState, ErrorState } from '../../../components/StateViews';
import { fetchBotFiles, uploadBotFile, removeBotFile } from '../../../botsApi';
import { useToast } from '../../../components/Toast';
import { useConfirm } from '../../../components/ConfirmDialog';

const iconFor=(mime='')=>mime.startsWith('image/')?'image-outline':mime.startsWith('video/')?'videocam-outline':mime.startsWith('audio/')?'mic-outline':'document-text-outline';
const sizeLabel=(n)=>n>=1048576?`${(n/1048576).toFixed(1)} MB`:`${Math.ceil(n/1024)} KB`;
export default function BotFilesScreen(){
 const {id}=useLocalSearchParams(); const {colors}=useTheme(); const styles=useMemo(()=>getStyles(colors),[colors]); const toast=useToast(); const confirm=useConfirm();
 const [files,setFiles]=useState(null),[phase,setPhase]=useState('loading'),[refreshing,setRefreshing]=useState(false),[uploading,setUploading]=useState(false);
 const load=useCallback(async()=>{try{setFiles(await fetchBotFiles(id));setPhase('ready')}catch{setPhase('error')}},[id]); useFocusEffect(useCallback(()=>{load()},[load]));
 async function pick(){const r=await DocumentPicker.getDocumentAsync({copyToCacheDirectory:true,multiple:false});if(r.canceled)return;setUploading(true);try{const saved=await uploadBotFile(id,r.assets[0]);setFiles(v=>[saved,...(v||[])]);toast.success('File uploaded')}catch(e){toast.error(e.message||"Couldn't upload file")}finally{setUploading(false)}}
 async function remove(f){if(!await confirm({title:'Delete file?',message:`${f.name} will be removed from private storage.`,confirmLabel:'Delete',destructive:true}))return;try{await removeBotFile(id,f.id);setFiles(v=>v.filter(x=>x.id!==f.id))}catch(e){toast.error(e.message||"Couldn't delete file")}}
 if(phase==='loading')return <View style={styles.screen}><SkeletonList count={5}/></View>; if(phase==='error')return <View style={styles.screen}><ErrorState message="Couldn't load bot files." onRetry={()=>{setPhase('loading');load()}}/></View>;
 return <View style={styles.screen}><FlatList data={files} keyExtractor={f=>f.id} contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async()=>{setRefreshing(true);await load();setRefreshing(false)}} tintColor={colors.textMuted}/>} ListHeaderComponent={<Pressable style={styles.upload} onPress={pick} disabled={uploading}><Ionicons name="cloud-upload-outline" size={20} color={colors.accent}/><Text style={styles.uploadText}>{uploading?'Uploading…':'Upload private file'}</Text></Pressable>} renderItem={({item})=><Pressable style={styles.row} onLongPress={()=>remove(item)}><View style={styles.icon}><Ionicons name={iconFor(item.mimeType)} size={18} color={colors.textSecondary}/></View><View style={{flex:1}}><Text style={styles.name} numberOfLines={1}>{item.name}</Text><Text style={styles.meta}>{sizeLabel(item.size)} · {new Date(item.createdAt).toLocaleDateString()}</Text></View></Pressable>} ListEmptyComponent={<EmptyState icon="folder-open-outline" title="No bot files" message="Files uploaded here are stored privately and served through authenticated bot routes."/>}/></View>
}
const getStyles=colors=>StyleSheet.create({screen:{flex:1,backgroundColor:colors.bg,paddingTop:space.md},list:{padding:space.lg,paddingBottom:space.xl*2,flexGrow:1},upload:{flexDirection:'row',gap:space.sm,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:colors.accent,borderRadius:radius.md,padding:space.md,marginBottom:space.lg},uploadText:{...type.body,color:colors.accent,fontWeight:'600'},row:{flexDirection:'row',alignItems:'center',gap:space.md,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,borderRadius:radius.md,padding:space.md,marginBottom:space.sm},icon:{width:36,height:36,borderRadius:radius.sm,backgroundColor:colors.surfaceRaised,alignItems:'center',justifyContent:'center'},name:{...type.body,color:colors.textPrimary},meta:{...type.small,color:colors.textMuted,marginTop:2}});
