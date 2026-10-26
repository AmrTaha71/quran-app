// Personal touches: Islamic greetings and a daily rotating dua,
// written as if speaking to the user directly, by the name they
// chose to be called by when known.

export const ISLAMIC_GREETING = 'السلام عليكم ورحمة الله وبركاته';

const DAILY_DUAS = [
  'تقبل الله منك، وجعل القرآن نوراً لقلبك وشفيعاً لك يوم القيامة',
  'بارك الله في وقتك وجهدك، وثبّت ما حفظت في صدرك',
  'زادك الله من فضله، وجعل كل آية تحفظها نوراً لك في الدنيا والآخرة',
  'اللهم اجعل القرآن ربيع قلبك، ونور صدرك، وجلاء حزنك',
  'تقبل الله سعيك، وبلغك حفظ كتابه كاملاً',
  'ربنا يبارك فيك، ويجعل تعبك في ميزان حسناتك',
];

// One dua per day, rotating deterministically through the year.
export function dailyDua(): string {
  const now = new Date();
  const dayOfYear = Math.floor(
    (now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000
  );
  return DAILY_DUAS[dayOfYear % DAILY_DUAS.length];
}
