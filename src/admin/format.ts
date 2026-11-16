export const money = (cents: number | string | null | undefined) =>
  cents == null
    ? "—"
    : new Intl.NumberFormat("bg-BG", {
        style: "currency",
        currency: "EUR",
      }).format(Number(cents) / 100);
export const dateTime = (date: Date | string | null | undefined) =>
  date
    ? new Intl.DateTimeFormat("bg-BG", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Europe/Sofia",
      }).format(new Date(date))
    : "—";
export const statusLabels: Record<string, string> = {
  draft: "Чернова",
  published: "Публикуван",
  hidden: "Скрит",
  archived: "Архивиран",
  new: "Нова",
  confirmed: "Потвърдена",
  preparing: "Подготвя се",
  waiting: "Чака клиента",
  ready: "Готова",
  out_for_delivery: "На път",
  delivered: "Доставена",
  cancelled: "Отказана",
  delivery_problem: "Проблем с доставката",
  pending: "Очаква плащане",
  paid: "Платена",
  refunded: "Възстановена",
  partial: "Частично плащане",
  cash: "В брой",
  card: "С карта",
  manual: "От магазина",
  brochure: "Брошура",
  owner: "Собственик",
  staff: "Служител",
  courier: "Доставчик",
};
Object.assign(statusLabels, {
  on_route: "На път",
  problem: "Проблем с доставката",
  local: "Добавен от магазина",
  requested: "Заявен",
  prepared: "Подготвен",
  replaced: "Заменен",
  missing: "Липсва",
  received: "Получена",
  accepted: "Приета",
  rejected: "Отхвърлена",
  resolved: "Приключена",
  partial_refund: "Частично възстановена",
  claim: "Рекламация",
  withdraw: "Законов отказ",
  assign: "Възложена доставка",
  move: "Промяна на интервал",
  contact: "Опит за връзка",
  payment: "Получено плащане",
  refund: "Възстановяване",
  item: "Подготовка на артикул",
  substitution_proposed: "Предложена замяна",
  "claim-status": "Решение по рекламация",
  phone: "телефон",
  sms: "SMS",
  in_person: "на място",
  email: "имейл",
});
export const label = (value: string) => statusLabels[value] || value;
