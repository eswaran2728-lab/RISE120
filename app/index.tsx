import { Text, View } from 'react-native';
import { t } from '../src/i18n';
import { tokens } from '../src/theme/tokens';

export default function Home() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.color.bg }}>
      <Text style={{ color: tokens.color.text, fontSize: 28 }}>{t('welcome.title')}</Text>
    </View>
  );
}
