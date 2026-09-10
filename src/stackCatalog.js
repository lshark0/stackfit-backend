// 기술 분야(카테고리) 정의 — 화면의 선택기와 동일한 기준입니다.
// 인재풀·공고 검색에서 "언어", "백엔드" 같은 분야로 거를 때 사용합니다.
const STACK_CATALOG = {
  '언어': ['Java','Python','JavaScript','TypeScript','C','C++','C#','Go','Kotlin','Swift','PHP','Ruby','Scala','R','SQL','Shell'],
  '백엔드': ['Spring','Spring Boot','Node.js','Express','NestJS','Django','Flask','FastAPI','.NET','Laravel','eGovFrame','MyBatis','JPA','Hibernate'],
  '프론트엔드': ['React','Vue','Angular','Next.js','Nuxt','Svelte','jQuery','HTML/CSS','Tailwind','Redux','Flutter','React Native'],
  '데이터베이스': ['Oracle','MySQL','MariaDB','PostgreSQL','MS-SQL','Tibero','MongoDB','Redis','Cassandra','Elasticsearch','Altibase','CUBRID'],
  '클라우드': ['AWS','Azure','GCP','NCP(네이버클라우드)','NHN Cloud','KT Cloud','OpenStack','VMware'],
  '인프라·운영': ['Linux','Unix','AIX','HP-UX','Windows Server','Docker','Kubernetes','Jenkins','GitLab CI','Ansible','Terraform','Nginx','Apache','WebLogic','JEUS','Tomcat','WebSphere'],
  '데이터·AI': ['Hadoop','Spark','Kafka','Airflow','TensorFlow','PyTorch','Pandas','Tableau','Power BI','ETL'],
  '보안': ['방화벽','IPS/IDS','WAF','DLP','SIEM','ISMS-P','모의해킹','취약점진단','접근제어'],
  '기타': ['Git','SVN','Jira','Confluence','Figma','Redmine','Nexus','SonarQube'],
};

const CATEGORIES = Object.keys(STACK_CATALOG);

// 보유 기술 목록이 특정 분야에 속하는지 판단합니다.
// 카탈로그에 정확히 없는 항목도 있으므로(직접 추가한 기술 등),
// 분야명 자체를 포함하는 경우도 함께 인정합니다. (예: 분야 '보안' ↔ 기술 '보안관제')
function matchesCategory(stack, category) {
  if (!category || category === '전체') return true;
  const list = STACK_CATALOG[category];
  if (!list) return true;

  const lowerList = list.map((v) => v.toLowerCase());
  const cat = String(category).toLowerCase();
  return (stack || []).some((s) => {
    const v = String(s).toLowerCase();
    return lowerList.includes(v) || v.includes(cat);
  });
}

module.exports = { STACK_CATALOG, CATEGORIES, matchesCategory };
