import { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { fetchRelayServer, fetchRelayChannels, fetchRelayMembers } from '../../../relayApi';
import { useTheme, type, space, radius } from '../../../theme';
import { ErrorState } from '../../../components/StateViews';

const dedupe = (rows) => [...new Map(rows.map((row) => [row.id, row])).values()];

export default function RelayServerScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [server, setServer] = useState(null);
  const [tab, setTab] = useState('channels');
  const [channels, setChannels] = useState([]);
  const [members, setMembers] = useState([]);
  const [channelCursor, setChannelCursor] = useState(null);
  const [memberCursor, setMemberCursor] = useState(null);
  const [channelMore, setChannelMore] = useState(false);
  const [memberMore, setMemberMore] = useState(false);
  const [phase, setPhase] = useState('loading');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [detail, channelPage, memberPage] = await Promise.all([
        fetchRelayServer(id), fetchRelayChannels(id), fetchRelayMembers(id),
      ]);
      setServer(detail);
      setChannels(channelPage.items ?? []); setChannelCursor(channelPage.nextCursor); setChannelMore(channelPage.hasMore);
      setMembers(memberPage.items ?? []); setMemberCursor(memberPage.nextCursor); setMemberMore(memberPage.hasMore);
      setPhase('ready');
    } catch { setPhase('error'); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function loadMore() {
    try {
      if (tab === 'channels' && channelMore && channelCursor) {
        const page = await fetchRelayChannels(id, channelCursor);
        setChannels((old) => dedupe([...old, ...(page.items ?? [])])); setChannelCursor(page.nextCursor); setChannelMore(page.hasMore);
      } else if (tab === 'members' && memberMore && memberCursor) {
        const page = await fetchRelayMembers(id, memberCursor);
        setMembers((old) => dedupe([...old, ...(page.items ?? [])])); setMemberCursor(page.nextCursor); setMemberMore(page.hasMore);
      }
    } catch { setPhase('error'); }
  }

  if (phase === 'error') return <View style={styles.screen}><Stack.Screen options={{ headerShown: false }} /><ErrorState message="Couldn't load this relay server." onRetry={() => { setPhase('loading'); load(); }} /></View>;
  const data = tab === 'channels' ? channels : members;
  return <View style={styles.screen}>
    <Stack.Screen options={{ headerShown: false }} />
    <View style={styles.header}><Pressable onPress={() => router.back()} hitSlop={10}><Ionicons name="chevron-back" size={26} color={colors.accent}/></Pressable><View style={styles.heading}><Text style={styles.title} numberOfLines={1}>{server?.name ?? 'Server Relay'}</Text><Text style={styles.subtitle}>Read only</Text></View></View>
    <View style={styles.tabs}>{['channels','members'].map((key)=><Pressable key={key} style={[styles.tab,tab===key&&styles.activeTab]} onPress={()=>setTab(key)}><Text style={[styles.tabText,tab===key&&styles.activeText]}>{key[0].toUpperCase()+key.slice(1)}</Text></Pressable>)}</View>
    <FlatList data={data} keyExtractor={(item)=>item.id} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async()=>{setRefreshing(true);await load();setRefreshing(false)}}/>} contentContainerStyle={styles.list} onEndReached={loadMore} onEndReachedThreshold={0.4} renderItem={({item})=>tab==='channels'?<Pressable style={styles.row} onPress={()=>router.push(`/server/${id}/channel/${item.id}`)}><Ionicons name={item.private?'lock-closed-outline':'chatbubble-outline'} size={19} color={colors.textSecondary}/><View style={styles.rowText}><Text style={styles.name}>#{item.name}</Text><Text style={styles.meta} numberOfLines={1}>{item.topic||'Channel history'}</Text></View><Ionicons name="chevron-forward" size={17} color={colors.textMuted}/></Pressable>:<View style={styles.row}><View style={styles.avatar}><Text style={styles.avatarText}>{(item.name||'?').slice(0,1).toUpperCase()}</Text></View><View style={styles.rowText}><Text style={styles.name}>{item.name}</Text><Text style={styles.meta}>@{item.username} · {item.role}</Text></View>{item.online?<View style={styles.online}/>:null}</View>} ListFooterComponent={(tab==='channels'?channelMore:memberMore)?<Text style={styles.more}>Loading more…</Text>:null}/>
  </View>;
}
function makeStyles(c){return StyleSheet.create({screen:{flex:1,backgroundColor:c.bg},header:{flexDirection:'row',alignItems:'center',paddingHorizontal:space.md,paddingTop:space.lg,paddingBottom:space.sm},heading:{marginLeft:space.sm},title:{...type.h1,color:c.textPrimary},subtitle:{...type.small,color:c.textMuted},tabs:{flexDirection:'row',marginHorizontal:space.lg,backgroundColor:c.surface,borderRadius:radius.lg,padding:3},tab:{flex:1,alignItems:'center',paddingVertical:8,borderRadius:radius.md},activeTab:{backgroundColor:c.surfaceRaised},tabText:{...type.body,color:c.textMuted},activeText:{color:c.textPrimary,fontWeight:'700'},list:{padding:space.lg,gap:8},row:{flexDirection:'row',alignItems:'center',gap:space.md,padding:space.md,backgroundColor:c.surface,borderRadius:radius.lg,borderWidth:1,borderColor:c.border},rowText:{flex:1},name:{...type.body,color:c.textPrimary,fontWeight:'600'},meta:{...type.small,color:c.textMuted,marginTop:2},avatar:{width:34,height:34,borderRadius:17,alignItems:'center',justifyContent:'center',backgroundColor:c.surfaceRaised},avatarText:{color:c.textPrimary,fontWeight:'700'},online:{width:9,height:9,borderRadius:5,backgroundColor:c.online},more:{...type.small,color:c.textMuted,textAlign:'center',padding:space.md}})}
