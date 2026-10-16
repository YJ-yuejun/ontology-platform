import { ArrowLeft, ChevronRight, Waypoints } from 'lucide-react';
import { useEffect } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import Ontologies from './Ontologies';
import Overview from './Overview';

export default function OntologyWorkspace({ ontologies, activeId, chooseOntology, onCreate, ...pageProps }) {
  const { ontologyId } = useParams();
  const navigate = useNavigate();
  const ontology = ontologyId ? ontologies.find((item) => item.id === ontologyId) : null;

  useEffect(() => {
    if (ontology && activeId !== ontology.id) chooseOntology(ontology.id);
  }, [ontology?.id, activeId]);

  if (!ontologyId) {
    return <Ontologies
      ontologies={ontologies}
      activeId={activeId}
      onCreate={onCreate}
      notify={pageProps.notify}
      onOpen={(item) => {
        chooseOntology(item.id);
        navigate(`/ontology/overview/${item.id}`);
      }}
    />;
  }

  if (!ontology && ontologies.length) return <Navigate to="/ontology/overview" replace />;
  if (!ontology) return null;

  const switchOntology = (id) => {
    chooseOntology(id);
    navigate(`/ontology/overview/${id}`);
  };

  return <div className="ontology-workspace-detail">
    <section className="ontology-detail-nav">
      <button className="ontology-back" onClick={() => navigate('/ontology/overview')}><ArrowLeft size={16} /> 返回全部本体</button>
      <div className="ontology-breadcrumb"><Waypoints size={15} /><span>本体工作台</span><ChevronRight size={13} /><strong>{ontology.name}</strong></div>
      <label><span>切换本体</span><select value={ontology.id} onChange={(event) => switchOntology(event.target.value)}>{ontologies.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.version}</option>)}</select></label>
    </section>
    <Overview {...pageProps} activeId={ontology.id} active={ontology} chooseOntology={switchOntology} />
  </div>;
}
